import { bodyTerms, termsIn } from '../../core/glossary/match.js';
import { toHalfWidth } from '../../core/text/width.js';
import type { Glossary, Term } from '../../core/glossary/types.js';
import type { TextUnit, TranslationEntry, UnitKind } from '../../core/types.js';
import { scopeLabel } from '../../shared/rows.js';
import { finalPrompt } from '../../core/glossary/prompts.js';
import { targetBody, unitParts } from './batches.js';
import { BatchJob, type JobOptions } from './job.js';

export type ReviewScope = 'all' | 'unreviewed' | 'file';
export interface ReviewItem { i: number; id: string; kind: UnitKind; speaker: string | null; speakerLine: string | null; source: string; target: string }
export interface ReviewBatch { label: string; file: string; items: ReviewItem[] }

const DEFAULT_MAX_ITEMS = 60;
const DEFAULT_MAX_CHARS = 8000;

export function estimateTokens(chars: number): number {
  return Math.ceil(chars * 1.2);
}

/** Translated units (translated, needs-review or approved) in the scope, grouped per file into batches, with an input-token estimate. */
export function planReview(
  units: TextUnit[],
  entryOf: (id: string) => TranslationEntry,
  glossary: Glossary,
  o: { scope: ReviewScope; file?: string; maxItems?: number; maxChars?: number },
): { batches: ReviewBatch[]; items: number; estimatedInputTokens: number } {
  const maxItems = o.maxItems ?? DEFAULT_MAX_ITEMS;
  const maxChars = o.maxChars ?? DEFAULT_MAX_CHARS;
  const pattern = glossary.rules.speakerPattern;
  const byFile = new Map<string, ReviewItem[][]>();
  const sizes = new Map<ReviewItem[], number>();
  let items = 0;
  let chars = 0;
  for (const u of units) {
    const e = entryOf(u.id);
    if (e.target === null || (e.status !== 'translated' && e.status !== 'needs-review' && e.status !== 'approved')) continue;
    const file = u.refs[0]?.file ?? '';
    if (o.scope === 'file' && file !== o.file) continue;
    if (o.scope === 'unreviewed' && e.reviewedAt && e.reviewedAt >= e.updatedAt) continue;
    const p = unitParts(u, pattern);
    const target = targetBody(e.target, p.speakerLine);
    const len = p.body.length + target.length;
    const groups = byFile.get(file) ?? [];
    byFile.set(file, groups);
    let cur = groups.at(-1);
    if (!cur || cur.length >= maxItems || (sizes.get(cur) ?? 0) + len > maxChars) {
      cur = [];
      groups.push(cur);
      sizes.set(cur, 0);
    }
    cur.push({ i: cur.length, id: u.id, kind: u.kind, speaker: p.speaker, speakerLine: p.speakerLine, source: p.body, target });
    sizes.set(cur, sizes.get(cur)! + len);
    items++;
    chars += len;
  }
  const batches: ReviewBatch[] = [];
  for (const [file, groups] of byFile) {
    groups.forEach((g, n) => batches.push({ label: `${scopeLabel(file)} (${n + 1}/${groups.length})`, file, items: g }));
  }
  chars += batches.length * finalPrompt('review', glossary).length;
  return { batches, items, estimatedInputTokens: items === 0 ? 0 : estimateTokens(chars) };
}

export const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    problems: {
      type: 'array',
      items: {
        type: 'object',
        properties: { i: { type: 'integer' }, problem: { type: 'string' }, suggestion: { type: 'string' } },
        required: ['i', 'problem', 'suggestion'],
      },
    },
  },
  required: ['problems'],
} as const;

export interface ReviewAnswer { problems: { i: number; problem: string; suggestion: string }[] }

export function isReviewAnswer(v: unknown): v is ReviewAnswer {
  return !!v && typeof v === 'object' && Array.isArray((v as any).problems)
    && (v as any).problems.every((p: any) => p && Number.isInteger(p.i) && typeof p.problem === 'string' && typeof p.suggestion === 'string');
}

function batchTerms(batch: ReviewBatch, terms: Term[]): Term[] {
  const found = new Set<string>();
  for (const item of batch.items) for (const t of termsIn(item.source, terms)) found.add(t.id);
  return terms.filter((t) => found.has(t.id));
}

export function buildReviewPrompt(batch: ReviewBatch, glossary: Glossary): { system: string; user: string } {
  const system = finalPrompt('review', glossary);
  const speakers = new Set(batch.items.map((i) => i.speaker).filter((s): s is string => s !== null));
  const user = {
    terms: batchTerms(batch, bodyTerms(glossary.terms)).map((t) => ({ source: t.source, target: t.target })),
    characters: glossary.characters.filter((c) => speakers.has(c.source)).map((c) => ({
      name: c.source, target: c.target, speech: c.speech,
      ...(c.firstPerson ? { firstPerson: c.firstPerson } : {}), ...(c.addressing ? { addressing: c.addressing } : {}), ...(c.moanStyle ? { moanStyle: c.moanStyle } : {}),
    })),
    items: batch.items.map((i) => ({ i: i.i, kind: i.kind, speaker: i.speaker, source: i.source, target: i.target })),
  };
  return { system, user: JSON.stringify(user) };
}

/** Reviews translated units batch by batch; only units with a problem get a remark. */
export class ReviewJob extends BatchJob<ReviewBatch> {
  constructor(o: JobOptions & { scope?: { scope: ReviewScope; file?: string } }) {
    super(o, 'review');
    this.scope = o.scope ?? { scope: 'all' };
  }

  private readonly scope: { scope: ReviewScope; file?: string };

  protected plan(): { batches: ReviewBatch[]; total: number } {
    const svc = this.o.svc;
    const r = planReview(svc.units(), (id) => svc.entry(id), svc.glossary(), { ...this.scope, maxItems: this.o.maxItems, maxChars: this.o.maxChars });
    return { batches: r.batches, total: r.items };
  }

  protected async runBatch(batch: ReviewBatch, signal: AbortSignal): Promise<'next' | 'limit' | 'failed' | 'stopped'> {
    this.update({ label: batch.label });
    const glossary = this.o.svc.glossary();
    const prompt = buildReviewPrompt(batch, glossary);
    let retried = false;
    for (;;) {
      const r = await this.call({ system: prompt.system, user: prompt.user, schema: REVIEW_SCHEMA, validate: isReviewAnswer, signal });
      if (r.ok) {
        await this.apply(batch, r.data);
        return 'next';
      }
      const what = this.failure(r, retried);
      if (what === 'retry') {
        retried = true;
        continue;
      }
      if (what === 'split') {   // refused or malformed: this batch is skipped
        this.update({ done: this.p.done + batch.items.length, errors: this.p.errors + 1 });
        return 'next';
      }
      return what;
    }
  }

  private async apply(batch: ReviewBatch, answer: ReviewAnswer): Promise<void> {
    const svc = this.o.svc;
    const byI = new Map(batch.items.map((it) => [it.i, it]));
    const flagged = new Set<string>();
    for (const p of answer.problems) {
      const item = byI.get(p.i);
      if (!item || flagged.has(item.id)) continue;
      const current = svc.entry(item.id).target;
      if (current === null) continue;
      flagged.add(item.id);
      // Only the body was reviewed: the translated speaker line is put back in front.
      // A value with pieces that must stay as they are (needs-decision) is not touched.
      const rules = svc.glossary().rules;
      const body = rules.halfWidth && !svc.unit(item.id)?.needsDecision ? toHalfWidth(p.suggestion, { brackets: rules.halfWidthBrackets }) : p.suggestion;
      const suggestion = item.speakerLine !== null && current.includes('\n') ? current.slice(0, current.indexOf('\n') + 1) + body : body;
      await svc.setReview(item.id, { problem: p.problem, suggestion, model: this.o.model }, 'review');
    }
    const rest = batch.items.map((i) => i.id).filter((id) => !flagged.has(id));
    if (rest.length > 0) await svc.markReviewed(rest, 'review');
    this.update({ done: this.p.done + batch.items.length });
  }
}
