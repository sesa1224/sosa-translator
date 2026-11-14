import { bodyTerms, termsIn } from '../../core/glossary/match.js';
import { finalPrompt } from '../../core/glossary/prompts.js';
import type { Glossary, Term } from '../../core/glossary/types.js';
import { splitSpeaker } from '../../core/text/speaker.js';
import type { TextUnit, TranslationEntry, TranslationStatus, UnitKind } from '../../core/types.js';
import { scopeLabel } from '../../shared/rows.js';
import { keepPieces } from '../../core/decisions/keys.js';
import { confirmedDecisionFor, isTranslatable } from '../../core/decisions/store.js';
import type { Decisions } from '../../core/decisions/types.js';

export { formatRulesText } from '../../core/glossary/prompts.js';

/** One unit as sent to the model. text is the body with the speaker line taken off. */
export interface BatchItem {
  i: number; id: string; kind: UnitKind; speaker: string | null; speakerLine: string | null; text: string; keep?: string[];
  /** The older version's sentence and translation (speaker line taken off) when the source changed a little. */
  previous?: { source: string; target: string | null };
}
export interface Batch { label: string; file: string; items: BatchItem[]; context: { speaker: string | null; source: string; target: string | null }[] }

const DEFAULT_MAX_ITEMS = 40;
const DEFAULT_MAX_CHARS = 6000;
const CONTEXT_LINES = 3;
const CONTEXT_KINDS = new Set<UnitKind>(['dialogue', 'scroll']);

/** Speaker, speaker line and body of a unit under the glossary's speaker pattern. */
export function unitParts(u: TextUnit, pattern: string | null): { speaker: string | null; speakerLine: string | null; body: string } {
  const s = splitSpeaker(u.source, u.kind === 'dialogue' ? pattern : null);
  return { speaker: u.speaker ? u.speaker : s.speaker, speakerLine: s.speakerLine, body: s.body };
}

/** The body of a translation whose source had a speaker line (its first line is the translated speaker line). */
export function targetBody(target: string, speakerLine: string | null): string {
  if (speakerLine === null) return target;
  const nl = target.indexOf('\n');
  return nl < 0 ? target : target.slice(nl + 1);
}

/**
 * Groups the units to translate into batches: per file of the first ref, in original order,
 * at most maxItems items and maxChars body characters each.
 */
export function planBatches(
  units: TextUnit[],
  entryOf: (id: string) => TranslationEntry,
  glossary: Glossary,
  o: { maxItems?: number; maxChars?: number; ids?: string[]; includeStatuses?: TranslationStatus[]; decisions?: Decisions } = {},
): Batch[] {
  const maxItems = o.maxItems ?? DEFAULT_MAX_ITEMS;
  const maxChars = o.maxChars ?? DEFAULT_MAX_CHARS;
  const statuses = new Set(o.includeStatuses ?? ['untranslated']);
  const only = o.ids ? new Set(o.ids) : null;
  const pattern = glossary.rules.speakerPattern;

  const byFile = new Map<string, TextUnit[]>();
  for (const u of units) {
    const file = u.refs[0]?.file ?? '';
    const list = byFile.get(file) ?? [];
    list.push(u);
    byFile.set(file, list);
  }

  const out: Batch[] = [];
  for (const [file, list] of byFile) {
    const fileBatches: { items: BatchItem[]; startIndex: number }[] = [];
    let cur: { items: BatchItem[]; startIndex: number } | null = null;
    let chars = 0;
    list.forEach((u, index) => {
      if (!isTranslatable(u, o.decisions ?? {})) return;
      if (only && !only.has(u.id)) return;
      if (!statuses.has(entryOf(u.id).status)) return;
      const p = unitParts(u, pattern);
      if (cur && (cur.items.length >= maxItems || chars + p.body.length > maxChars)) cur = null;
      if (!cur) {
        cur = { items: [], startIndex: index };
        fileBatches.push(cur);
        chars = 0;
      }
      const item: BatchItem = { i: cur.items.length, id: u.id, kind: u.kind, speaker: p.speaker, speakerLine: p.speakerLine, text: p.body };
      // A needs-decision unit carries the pieces that must stay as they are.
      const dec = u.needsDecision ? confirmedDecisionFor(u, o.decisions ?? {}) : null;
      const pieces = dec ? keepPieces(u.source, dec.keep) : null;
      if (pieces && pieces.some((x) => x !== '')) item.keep = pieces;
      const prev = entryOf(u.id).previous;
      if (prev) {
        const old = unitParts({ ...u, source: prev.source }, pattern);
        item.previous = { source: old.body, target: prev.target === null ? null : targetBody(prev.target, old.speakerLine) };
      }
      cur.items.push(item);
      chars += p.body.length;
    });
    fileBatches.forEach((fb, n) => {
      const context: Batch['context'] = [];
      for (let k = fb.startIndex - 1; k >= 0 && context.length < CONTEXT_LINES; k--) {
        const u = list[k];
        if (!CONTEXT_KINDS.has(u.kind)) continue;
        const p = unitParts(u, pattern);
        const target = entryOf(u.id).target;
        context.unshift({ speaker: p.speaker, source: p.body, target: target === null ? null : targetBody(target, p.speakerLine) });
      }
      out.push({ label: `${scopeLabel(file)} (${n + 1}/${fileBatches.length})`, file, items: fb.items, context });
    });
  }
  return out;
}

export const TRANSLATE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          i: { type: 'integer' },
          t: { type: ['string', 'null'] },
          declined: { type: 'string' },
          newTerms: {
            type: 'array',
            items: { type: 'object', properties: { source: { type: 'string' }, target: { type: 'string' } }, required: ['source', 'target'] },
          },
        },
        required: ['i', 't'],
      },
    },
  },
  required: ['items'],
} as const;

export interface TranslateAnswer { items: { i: number; t: string | null; declined?: string; newTerms?: { source: string; target: string }[] }[] }

export function isTranslateAnswer(v: unknown): v is TranslateAnswer {
  if (!v || typeof v !== 'object' || !Array.isArray((v as any).items)) return false;
  return (v as any).items.every((x: any) => x && typeof x === 'object' && Number.isInteger(x.i)
    && (typeof x.t === 'string' || x.t === null)
    && (x.declined === undefined || typeof x.declined === 'string')
    && (x.newTerms === undefined || (Array.isArray(x.newTerms) && x.newTerms.every((n: any) => n && typeof n.source === 'string' && typeof n.target === 'string'))));
}

/**
 * Models sometimes write a line break as the two characters backslash + n. RPG Maker has no such code
 * (\n[1] and \n<name> are names), so a lone one becomes a real line break unless the source itself has one.
 */
export function fixLiteralBreaks(t: string, source: string): string {
  const lone = /\\n(?![[<A-Za-z])/g;
  if (/\\n(?![[<A-Za-z])/.test(source)) return t;
  return t.replace(lone, '\n');
}

function speakersOf(batch: Batch): Set<string> {
  return new Set(batch.items.map((i) => i.speaker).filter((s): s is string => s !== null));
}

function batchTerms(batch: Batch, terms: Term[]): Term[] {
  const found = new Map<string, Term>();
  for (const item of batch.items) for (const t of termsIn(item.text, terms)) found.set(t.id, t);
  return terms.filter((t) => found.has(t.id));
}

export function buildTranslatePrompt(batch: Batch, glossary: Glossary): { system: string; user: string } {
  // Only batches with a changed sentence get the line about it, so every other prompt stays exactly as it was.
  const system = finalPrompt('translate', glossary, { previous: batch.items.some((i) => i.previous) });

  const speakers = speakersOf(batch);
  const user = {
    terms: batchTerms(batch, bodyTerms(glossary.terms)).map((t) => ({ source: t.source, target: t.target })),
    characters: glossary.characters.filter((c) => speakers.has(c.source)).map((c) => {
      const out: Record<string, string> = { name: c.source, target: c.target, speech: c.speech };
      if (c.firstPerson) out.firstPerson = c.firstPerson;
      if (c.addressing) out.addressing = c.addressing;
      if (c.moanStyle) out.moanStyle = c.moanStyle;
      return out;
    }),
    context: batch.context,
    items: batch.items.map((i) => ({ i: i.i, kind: i.kind, speaker: i.speaker, text: i.text, ...(i.keep ? { keep: i.keep } : {}), ...(i.previous ? { previous: i.previous } : {}) })),
  };
  return { system, user: JSON.stringify(user) };
}
