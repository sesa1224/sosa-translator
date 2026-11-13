import { EventEmitter } from 'node:events';
import {
  buildPatch,
  checkTranslation,
  createProject,
  extractAll,
  loadUnits,
  openProject,
  TranslationStore,
  type BuildResult,
  type Issue,
  type ProjectMeta,
  type TextUnit,
  type TranslationEntry,
  type ReviewNote,
  type TranslationStatus,
} from '../core/index.js';
import { loadGlossary, saveGlossary, termId } from '../core/glossary/store.js';
import { termsIn } from '../core/glossary/match.js';
import type { Glossary, Term } from '../core/glossary/types.js';
import type { ChangeEvent, Origin } from '../shared/api.js';

const UNDO_LIMIT = 200;

interface UndoRecord { id: string; before: TranslationEntry; origin: Origin }

/** Reason stored for terms the model brought up while translating. */
export const NEW_TERM_REASON = '번역 중 새로 나옴';

export interface ProjectService {
  on(event: 'changed', listener: (e: ChangeEvent) => void): this;
  on(event: 'glossary-changed', listener: (g: Glossary) => void): this;
  off(event: 'changed', listener: (e: ChangeEvent) => void): this;
  off(event: 'glossary-changed', listener: (g: Glossary) => void): this;
  emit(event: 'changed', e: ChangeEvent): boolean;
  emit(event: 'glossary-changed', g: Glossary): boolean;
}

/**
 * Sole owner of an open project. Every write goes through an internal queue,
 * runs one at a time, saves translations.json and then emits 'changed'.
 */
export class ProjectService extends EventEmitter {
  private readonly byId: Map<string, TextUnit>;
  private readonly history: UndoRecord[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  private constructor(
    readonly projectDir: string,
    readonly meta: ProjectMeta,
    private readonly unitList: TextUnit[],
    private readonly store: TranslationStore,
    private gloss: Glossary,
  ) {
    super();
    this.byId = new Map(unitList.map((u) => [u.id, u]));
  }

  /** createProject + extractAll, then opens it. */
  static async create(gameDir: string, projectDir: string, name: string): Promise<ProjectService> {
    const meta = await createProject(gameDir, projectDir, name);
    const { units } = await extractAll(projectDir);
    const store = await TranslationStore.load(projectDir);
    return new ProjectService(projectDir, meta, units, store, await loadGlossary(projectDir));
  }

  static async open(projectDir: string): Promise<ProjectService> {
    const meta = await openProject(projectDir);
    const units = await loadUnits(projectDir);
    const store = await TranslationStore.load(projectDir);
    return new ProjectService(projectDir, meta, units, store, await loadGlossary(projectDir));
  }

  units(): TextUnit[] {
    return this.unitList;
  }

  unit(id: string): TextUnit | undefined {
    return this.byId.get(id);
  }

  entry(id: string): TranslationEntry {
    return this.store.get(id);
  }

  /** A copy of the project's glossary. */
  glossary(): Glossary {
    return structuredClone(this.gloss);
  }

  /** Replaces the glossary, saves glossary.json and emits 'glossary-changed'. */
  setGlossary(g: Glossary): Promise<void> {
    return this.enqueue(async () => {
      this.gloss = structuredClone(g);
      await saveGlossary(this.projectDir, this.gloss);
      this.emit('glossary-changed', this.glossary());
    });
  }

  /** Whether the unit's source holds a term still going on its recommended candidate. */
  usesProvisional(id: string): boolean {
    const u = this.byId.get(id);
    if (!u) return false;
    const provisional = this.gloss.terms.filter((t) => t.status === 'provisional');
    return provisional.length > 0 && termsIn(u.source, provisional).length > 0;
  }

  /** Adds terms the model brought up as provisional, skipping sources already in the glossary. Returns the added terms. */
  async addTermCandidates(terms: { source: string; target: string }[]): Promise<Term[]> {
    const known = new Set(this.gloss.terms.map((t) => t.source));
    const added: Term[] = [];
    for (const n of terms) {
      const source = n.source.trim();
      const target = n.target.trim();
      if (!source || !target || known.has(source)) continue;
      known.add(source);
      added.push({ id: termId(source), source, target, category: 'term', status: 'provisional', candidates: [{ target, reason: NEW_TERM_REASON }] });
    }
    if (added.length > 0) await this.setGlossary({ ...this.gloss, terms: [...this.gloss.terms, ...added] });
    return added;
  }

  /** Marks a unit the model would not translate. */
  setDeclined(id: string, reason: string, origin: Origin): Promise<void> {
    return this.mutate(origin, () => {
      this.require(id);
      this.remember(id, origin);
      this.store.restore(id, { target: null, status: 'declined', updatedAt: new Date().toISOString(), declinedReason: reason });
      return { ids: [id], result: undefined };
    });
  }

  /**
   * Puts a reviewer's remark on a translated unit (status back to 'needs-review'), or removes it (null).
   * The translation and its updatedAt are kept; reviewedAt is set.
   */
  setReview(id: string, review: ReviewNote | null, origin: Origin): Promise<void> {
    return this.mutate(origin, () => {
      this.require(id);
      const e = this.store.get(id);
      if (e.target === null) throw new Error('번역이 없는 항목입니다');
      this.remember(id, origin);
      const next: TranslationEntry = { ...e, reviewedAt: new Date().toISOString() };
      if (review) {
        next.review = { ...review };
        next.status = 'needs-review';
      } else delete next.review;
      this.store.restore(id, next);
      return { ids: [id], result: undefined };
    });
  }

  /** Writes the reviewer's suggestion as the translation (origin 'review') and removes the remark. */
  acceptReview(id: string): Promise<Issue[]> {
    return this.mutate('review', () => {
      const unit = this.require(id);
      const e = this.store.get(id);
      if (!e.review) throw new Error('검수 의견이 없습니다');
      const issues = this.check(unit, e.review.suggestion);
      const status: TranslationStatus = issues.some((i) => i.severity === 'error') ? 'error' : 'needs-review';
      this.remember(id, 'review');
      const now = new Date().toISOString();
      this.store.restore(id, { target: e.review.suggestion, status, updatedAt: now, reviewedAt: now });
      return { ids: [id], result: issues };
    });
  }

  /** Removes the reviewer's remark and keeps the translation. */
  rejectReview(id: string): Promise<void> {
    return this.mutate('user', () => {
      this.require(id);
      const e = this.store.get(id);
      if (!e.review) return { ids: [], result: undefined };
      this.remember(id, 'user');
      const { review: _dropped, ...rest } = e;
      this.store.restore(id, rest);
      return { ids: [id], result: undefined };
    });
  }

  /** Records that a review looked at these units (status and translation unchanged, not undoable). */
  markReviewed(ids: string[], origin: Origin): Promise<void> {
    return this.mutate(origin, () => {
      const now = new Date().toISOString();
      const done: string[] = [];
      for (const id of ids) {
        this.require(id);
        const e = this.store.get(id);
        if (e.target === null) continue;
        this.store.restore(id, { ...e, reviewedAt: now });
        done.push(id);
      }
      return { ids: done, result: undefined };
    });
  }

  private check(unit: TextUnit, target: string): Issue[] {
    const g = this.gloss;
    return checkTranslation(unit, target, g.rules, { terms: g.terms, maxLineWidthChars: g.rules.maxLineWidthChars });
  }

  setTranslation(id: string, target: string, origin: Origin): Promise<Issue[]> {
    return this.mutate(origin, () => {
      const unit = this.require(id);
      const issues = this.check(unit, target);
      const status: TranslationStatus = issues.some((i) => i.severity === 'error') ? 'error' : 'needs-review';
      this.remember(id, origin);
      this.store.set(id, target, status);
      return { ids: [id], result: issues };
    });
  }

  setStatus(id: string, status: TranslationStatus, origin: Origin): Promise<void> {
    return this.mutate(origin, () => {
      this.require(id);
      this.remember(id, origin);
      this.store.setStatus(id, status);
      return { ids: [id], result: undefined };
    });
  }

  clearTranslation(id: string, origin: Origin): Promise<void> {
    return this.mutate(origin, () => {
      this.require(id);
      this.remember(id, origin);
      this.store.restore(id, { target: null, status: 'untranslated', updatedAt: new Date().toISOString() });
      return { ids: [id], result: undefined };
    });
  }

  /** Check result for the current target ([] when there is none). */
  issues(id: string): Issue[] {
    const unit = this.require(id);
    const target = this.store.get(id).target;
    return target === null ? [] : this.check(unit, target);
  }

  /** Reverts the most recent change (of that origin, if given). Returns the changed ids, or []. */
  undo(origin?: Origin): Promise<string[]> {
    return this.mutate(origin ?? 'user', () => {
      let i = this.history.length - 1;
      while (i >= 0 && origin !== undefined && this.history[i].origin !== origin) i--;
      if (i < 0) return { ids: [], result: [] };
      const [rec] = this.history.splice(i, 1);
      this.store.restore(rec.id, rec.before);
      return { ids: [rec.id], result: [rec.id] };
    });
  }

  /** Builds a patch zip. Status changes made by the build's check are saved and announced. */
  build(): Promise<BuildResult> {
    return this.enqueue(async () => {
      const before = this.store.entries();
      try {
        return await buildPatch(this.projectDir, this.unitList, this.store);
      } finally {
        const after = this.store.entries();
        const ids = Object.keys(after).filter((id) => before[id]?.status !== after[id].status);
        if (ids.length > 0) {
          await this.store.save();
          this.emit('changed', { ids, origin: 'user' });
        }
      }
    });
  }

  /** Waits for pending writes to finish. */
  async close(): Promise<void> {
    await this.queue.catch(() => undefined);
    this.removeAllListeners();
  }

  private require(id: string): TextUnit {
    const u = this.byId.get(id);
    if (!u) throw new Error(`없는 항목입니다: ${id}`);
    return u;
  }

  private remember(id: string, origin: Origin): void {
    this.history.push({ id, before: this.store.get(id), origin });
    if (this.history.length > UNDO_LIMIT) this.history.shift();
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private mutate<T>(origin: Origin, apply: () => { ids: string[]; result: T }): Promise<T> {
    return this.enqueue(async () => {
      const { ids, result } = apply();
      if (ids.length > 0) {
        await this.store.save();
        this.emit('changed', { ids, origin });
      }
      return result;
    });
  }
}
