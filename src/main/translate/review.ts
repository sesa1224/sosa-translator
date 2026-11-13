import { termsIn } from '../../core/glossary/match.js';
import type { Glossary, Term } from '../../core/glossary/types.js';
import type { TextUnit, TranslationEntry, UnitKind } from '../../core/types.js';
import { scopeLabel } from '../../shared/rows.js';
import { formatRulesText, targetBody, unitParts } from './batches.js';
import { BatchJob, type JobOptions } from './job.js';

export type ReviewScope = 'all' | 'unreviewed' | 'file';
export interface ReviewItem { i: number; id: string; kind: UnitKind; speaker: string | null; speakerLine: string | null; source: string; target: string }
export interface ReviewBatch { label: string; file: string; items: ReviewItem[] }

const DEFAULT_MAX_ITEMS = 60;
const DEFAULT_MAX_CHARS = 8000;

export function estimateTokens(chars: number): number {
  return Math.ceil(chars * 1.2);
}

/** Translated units (needs-review or approved) in the scope, grouped per file into batches, with an input-token estimate. */
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
    if (e.target === null || (e.status !== 'needs-review' && e.status !== 'approved')) continue;
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
  chars += batches.length * glossary.styleGuide.length;
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
  const system = [
    '너는 RPG Maker 게임 번역을 검수한다. 아래 번역 지침이 기준이다.',
    '',
    '<번역 지침>',
    glossary.styleGuide.trim(),
    '</번역 지침>',
    '',
    '형식 규칙:',
    ...formatRulesText(glossary.rules),
    '',
    '입력(JSON): terms 는 이 묶음의 용어(source 는 반드시 target 으로 옮긴다), characters 는 인물과 말투, items 는 검수할 항목(source 원문, target 번역, speaker 말하는 인물)이다.',
    '',
    '할 일:',
    '- 문제가 있는 항목만 돌려준다. 문제가 없으면 problems 를 빈 배열로 둔다.',
    '- 오역, 빠진 내용, 어색한 한국어, 인물 말투와 맞지 않는 어미, 지침의 의성어·신음 원칙에 어긋난 표기, 인물의 성격·신음 스타일과 맞지 않는 신음 표기, 용어집과 다른 용어가 대상이다.',
    '- 취향 차이만 있는 것은 돌려주지 않는다.',
    '- problem 에 무엇이 문제인지 한 문장으로 적는다.',
    '- suggestion 은 고친 번역문 전체이고 제어문자를 그대로 유지한다. 화자 이름은 넣지 않고 target 과 같은 범위만 쓴다.',
  ].join('\n');
  const speakers = new Set(batch.items.map((i) => i.speaker).filter((s): s is string => s !== null));
  const user = {
    terms: batchTerms(batch, glossary.terms).map((t) => ({ source: t.source, target: t.target })),
    characters: glossary.characters.filter((c) => speakers.has(c.source)).map((c) => ({ name: c.source, target: c.target, speech: c.speech, ...(c.moanStyle ? { moanStyle: c.moanStyle } : {}) })),
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
      const suggestion = item.speakerLine !== null && current.includes('\n') ? current.slice(0, current.indexOf('\n') + 1) + p.suggestion : p.suggestion;
      await svc.setReview(item.id, { problem: p.problem, suggestion, model: this.o.model }, 'review');
    }
    const rest = batch.items.map((i) => i.id).filter((id) => !flagged.has(id));
    if (rest.length > 0) await svc.markReviewed(rest, 'review');
    this.update({ done: this.p.done + batch.items.length });
  }
}
