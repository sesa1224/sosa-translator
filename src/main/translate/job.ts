// Background jobs that call the Claude CLI once per batch (translate, review, decide, glossary draft, notes).
// BatchJob runs the loop: pause, resume, stop, and pause on the usage limit so the job can go on later.
// batches.ts and material.ts choose what each call sees, so Claude gets only the lines and terms it needs.
import { EventEmitter } from 'node:events';
import type { Glossary } from '../../core/glossary/types.js';
import { composeSpeaker } from '../../core/text/speaker.js';
import { toHalfWidth } from '../../core/text/width.js';
import type { TranslationStatus } from '../../core/types.js';
import type { ChatUsage, JobKind, JobProgress, Origin } from '../../shared/api.js';
import { NEED_LOGIN } from '../claude/chat.js';
import type { JsonCallResult, runClaudeJson } from '../claude/json.js';
import type { ProjectService } from '../projectService.js';
import { buildTranslatePrompt, fixLiteralBreaks, isTranslateAnswer, planBatches, TRANSLATE_SCHEMA, type Batch, type BatchItem, type TranslateAnswer } from './batches.js';

export const REFUSED_REASON = '모델이 번역을 거절했습니다';
export const NO_REASON = '이유 없음';
export const ALL_STATUSES: TranslationStatus[] = ['untranslated', 'translated', 'needs-review', 'approved', 'error', 'declined'];

export interface JobOptions {
  svc: ProjectService;
  call: typeof runClaudeJson;
  claude: { command: string; prefixArgs?: string[] };
  model: string;
  cwd: string;
  ids?: string[];
  maxItems?: number;
  maxChars?: number;
}

export const addUsage = (a: ChatUsage, b: ChatUsage): ChatUsage =>
  ({ input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheCreate: a.cacheCreate + b.cacheCreate });

export interface JobLike {
  readonly progress: JobProgress;
  start(): Promise<void>;
  pause(): void; resume(): void; stop(): void;
}

/**
 * Shared run loop for batch jobs: one CLI call per batch, pause/resume/stop, usage-limit pause.
 * Subclasses plan the batches and handle one batch.
 */
export abstract class BatchJob<B> extends EventEmitter implements JobLike {
  protected queue: B[] = [];
  protected p: JobProgress;
  private abort: AbortController | null = null;
  private pauseRequested = false;
  private stopRequested = false;
  private loop: Promise<void> | null = null;
  private planned = false;
  private logOpen = false;

  constructor(protected readonly o: JobOptions, kind: JobKind) {
    super();
    this.p = { kind, state: 'idle', done: 0, total: 0, label: '', usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 }, declined: 0, errors: 0 };
  }

  get progress(): JobProgress {
    return { ...this.p, usage: { ...this.p.usage } };
  }

  /** Plans the batches; returns them and the number of items. */
  protected abstract plan(): { batches: B[]; total: number };
  /** Handles one batch. Returns 'next' when it is finished, or how the run should stop. */
  protected abstract runBatch(b: B, signal: AbortSignal): Promise<'next' | 'limit' | 'failed' | 'stopped'>;
  /**
   * Jobs that write translations log the whole run as one action (label gets the number of changed lines), so it
   * can be cancelled as the one thing the user started. A pause keeps it open; the end of the run closes it.
   */
  protected logAction(): { origin: Origin; label: (n: number) => string } | null {
    return null;
  }

  /** Closes the run's action once the job has ended for good (not on a pause). */
  private async closeLog(): Promise<void> {
    const spec = this.logAction();
    if (!this.logOpen || !spec || !['done', 'failed', 'stopped'].includes(this.p.state)) return;
    this.logOpen = false;
    await this.o.svc.endAction(spec.origin);
  }

  protected update(patch: Partial<JobProgress>): void {
    this.p = { ...this.p, ...patch };
    // Lines are only "being translated" while a call is out; a pause, stop or end leaves none.
    if (this.p.state !== 'running') delete this.p.pending;
    this.emit('progress', this.progress);
  }

  protected addUsage(u: ChatUsage): void {
    this.p.usage = addUsage(this.p.usage, u);
  }

  protected call<T>(o: { system: string; user: string; schema: object; validate: (v: unknown) => v is T; signal: AbortSignal; model?: string }): Promise<JsonCallResult<T>> {
    const { model, ...rest } = o;
    return this.o.call<T>({ command: this.o.claude.command, prefixArgs: this.o.claude.prefixArgs, cwd: this.o.cwd, model: model ?? this.o.model, ...rest })
      .then((r) => {
        this.addUsage(r.usage);
        return r;
      });
  }

  /** Runs until done or stopped; resolves when the job ends or pauses. */
  start(): Promise<void> {
    if (this.loop) return this.loop;
    if (!this.planned) {
      const { batches, total } = this.plan();
      this.queue = batches;
      this.planned = true;
      const spec = this.logAction();
      if (spec) {
        this.logOpen = true;
        void this.o.svc.beginAction(spec.origin, spec.label);
      }
      this.update({ total });
    }
    this.pauseRequested = false;
    this.update({ state: 'running', message: undefined });
    this.loop = this.runLoop().then(() => this.closeLog()).finally(() => { this.loop = null; });
    return this.loop;
  }

  /** Stops after the call in flight. */
  pause(): void {
    if (this.p.state === 'running') this.pauseRequested = true;
  }

  /** Goes on from where it stopped (the batch that hit the limit is sent again). */
  resume(): void {
    if (this.p.state === 'paused' || this.p.state === 'paused-limit') void this.start();
  }

  /** Cuts the call in flight. */
  stop(): void {
    this.stopRequested = true;
    this.abort?.abort();
    if (!this.loop && this.p.state !== 'done' && this.p.state !== 'failed') {
      this.update({ state: 'stopped' });
      void this.closeLog();
    }
  }

  private async runLoop(): Promise<void> {
    while (this.queue.length > 0) {
      if (this.stopRequested) return this.update({ state: 'stopped' });
      if (this.pauseRequested) return this.update({ state: 'paused' });
      const b = this.queue[0];
      this.abort = new AbortController();
      let outcome: 'next' | 'limit' | 'failed' | 'stopped';
      try {
        outcome = await this.runBatch(b, this.abort.signal);
      } catch (e) {
        this.update({ state: 'failed', message: e instanceof Error ? e.message : String(e) });
        return;
      } finally {
        this.abort = null;
      }
      if (outcome === 'next') {
        if (this.queue[0] === b) this.queue.shift();
        this.update({ pending: undefined });
        continue;
      }
      if (outcome === 'stopped' || this.stopRequested) return this.update({ state: 'stopped' });
      if (outcome === 'limit') return this.update({ state: 'paused-limit' });
      return this.update({ state: 'failed' });
    }
    if (this.stopRequested) return this.update({ state: 'stopped' });
    this.update({ state: 'done', label: '' });
  }

  /** Common handling of a failed call. 'retry' means: send the same batch once more. */
  protected failure(r: Extract<JsonCallResult<unknown>, { ok: false }>, retried: boolean): 'limit' | 'failed' | 'stopped' | 'retry' | 'split' {
    switch (r.kind) {
      case 'limit':
        this.p.message = r.message;
        return 'limit';
      case 'auth':
        this.p.message = NEED_LOGIN;
        return 'failed';
      case 'aborted':
        return 'stopped';
      case 'refused':
      case 'invalid':
        return 'split';
      default:
        if (retried) {
          this.p.message = r.message;
          return 'failed';
        }
        return 'retry';
    }
  }
}

function speakerTarget(speaker: string, g: Glossary): string {
  const term = g.terms.find((t) => t.category === 'name' && t.source === speaker && t.target !== '');
  if (term) return term.target;
  const card = g.characters.find((c) => c.source === speaker && c.target !== '');
  return card ? card.target : speaker;
}

/**
 * The full translation of one item from the model's answer for its body: literal breaks fixed, half-width marks,
 * the translated speaker line put back, and breaks moved for the game window. Shared by the translate job and the
 * one-line Claude draft so both give the same text for the same answer.
 */
export function finishTranslation(item: BatchItem, t: string, g: Glossary, svc: Pick<ProjectService, 'autoWrap'>): string {
  const broken = fixLiteralBreaks(t, item.text);
  // The model mixes ？ and ? within one game; a value with kept pieces is left as it came.
  const body = g.rules.halfWidth && !item.keep ? toHalfWidth(broken, { brackets: g.rules.halfWidthBrackets }) : broken;
  const full = item.speakerLine !== null && item.speaker !== null
    ? composeSpeaker(item.speakerLine, item.speaker, speakerTarget(item.speaker, g), body)
    : body;
  // Lines too wide for the game window get their breaks moved (the project's rule; the user's own edits never).
  return svc.autoWrap(item.id, full);
}

interface RetryInfo { previous: string; problems: string[] }

/** Translates every untranslated unit (or the given ids) in batches. */
export class TranslateJob extends BatchJob<Batch> {
  constructor(o: JobOptions) {
    super(o, 'translate');
  }

  protected logAction(): { origin: Origin; label: (n: number) => string } {
    const what = this.o.ids ? '골라서 번역' : '전체 번역';
    return { origin: 'batch', label: (n) => `${what} ${n.toLocaleString('en-US')}개` };
  }

  protected plan(): { batches: Batch[]; total: number } {
    const svc = this.o.svc;
    const batches = planBatches(svc.units(), (id) => svc.entry(id), svc.glossary(), {
      maxItems: this.o.maxItems, maxChars: this.o.maxChars, ids: this.o.ids,
      includeStatuses: this.o.ids ? ALL_STATUSES : undefined,
      decisions: svc.decisions(),
    });
    return { batches, total: batches.reduce((n, b) => n + b.items.length, 0) };
  }

  protected async runBatch(batch: Batch, signal: AbortSignal): Promise<'next' | 'limit' | 'failed' | 'stopped'> {
    this.update({ label: batch.label, pending: batch.items.map((it) => it.id) });
    const glossary = this.o.svc.glossary();
    let retried = false;
    for (;;) {
      const r = await this.send(batch, glossary, signal);
      if (r.ok) return this.apply(batch, r.data, glossary, signal);
      const what = this.failure(r, retried);
      if (what === 'retry') {
        retried = true;
        continue;
      }
      if (what === 'split') {
        if (batch.items.length > 1) {
          const half = Math.ceil(batch.items.length / 2);
          const parts = [batch.items.slice(0, half), batch.items.slice(half)].map((items) => ({ ...batch, items: items.map((it, i) => ({ ...it, i })) }));
          this.queue.splice(0, 1, ...parts);
          return 'next';
        }
        const item = batch.items[0];
        if (r.kind === 'refused') {
          await this.o.svc.setDeclined(item.id, REFUSED_REASON, 'batch');
          this.update({ done: this.progress.done + 1, declined: this.progress.declined + 1 });
        } else {
          this.update({ done: this.progress.done + 1, errors: this.progress.errors + 1 });
        }
        return 'next';
      }
      return what;
    }
  }

  private send(batch: Batch, glossary: Glossary, signal: AbortSignal, retry?: Map<number, RetryInfo>): Promise<JsonCallResult<TranslateAnswer>> {
    const prompt = buildTranslatePrompt(batch, glossary);
    let user = prompt.user;
    if (retry) {
      const u = JSON.parse(user);
      for (const it of u.items) Object.assign(it, retry.get(it.i));
      user = JSON.stringify(u);
    }
    return this.call({ system: prompt.system, user, schema: TRANSLATE_SCHEMA, validate: isTranslateAnswer, signal });
  }

  /** Writes one answer. Returns how many items were written and those whose translation failed the format check. */
  private async write(batch: Batch, answer: TranslateAnswer, g: Glossary): Promise<{ written: number; bad: { item: BatchItem; info: RetryInfo }[] }> {
    const svc = this.o.svc;
    const byI = new Map(batch.items.map((it) => [it.i, it]));
    const used = new Set<number>();
    const bad: { item: BatchItem; info: RetryInfo }[] = [];
    const newTerms: { source: string; target: string }[] = [];
    for (const a of answer.items) {
      const item = byI.get(a.i);
      if (!item || used.has(a.i)) continue;   // unknown or repeated number: dropped
      used.add(a.i);
      if (a.newTerms) newTerms.push(...a.newTerms);
      if (a.t === null) {
        await svc.setDeclined(item.id, a.declined?.trim() || NO_REASON, 'batch');
        this.p.declined++;
        continue;
      }
      const issues = await svc.setTranslation(item.id, finishTranslation(item, a.t, g, svc), 'batch');
      const errors = issues.filter((i) => i.severity === 'error').map((i) => i.message);
      if (errors.length > 0) bad.push({ item, info: { previous: a.t, problems: errors } });
    }
    if (newTerms.length > 0) await svc.addTermCandidates(newTerms);
    return { written: used.size, bad };
  }

  private async apply(batch: Batch, answer: TranslateAnswer, g: Glossary, signal: AbortSignal): Promise<'next' | 'limit' | 'failed' | 'stopped'> {
    // Items the model left out stay as they were (untranslated) and do not count as done.
    const { written, bad } = await this.write(batch, answer, g);
    this.update({ done: this.p.done + written });
    if (bad.length === 0) return 'next';

    const retryBatch: Batch = { ...batch, items: bad.map((b, i) => ({ ...b.item, i })) };
    const info = new Map(bad.map((b, i) => [i, b.info]));
    const r = await this.send(retryBatch, g, signal, info);
    if (!r.ok) {
      const what = this.failure(r, true);
      // The batch itself is finished; only a stop, limit or login problem ends the run.
      if (what === 'stopped' || what === 'limit' || what === 'failed') {
        if (this.queue[0] === batch) this.queue.shift();
        if (what === 'failed' && r.kind !== 'auth') {
          this.p.message = undefined;   // a broken retry only leaves those items as 'error'
          return 'next';
        }
        return what;
      }
      return 'next';
    }
    await this.write(retryBatch, r.data, g);   // still failing: left as 'error'
    this.update({});
    return 'next';
  }
}
