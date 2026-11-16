// Hands sentences to an outside translator and takes the reply back. buildPackage writes a self-contained JSON
// file (glossary, characters, context lines, reply format); planImport sorts a reply into new translations,
// conflicts with existing ones and unknown ids before anything is written (ProjectService.applyImport writes).
import { checkTranslation } from '../check/format.js';
import { keepPieces } from '../decisions/keys.js';
import { confirmedDecisionFor } from '../decisions/store.js';
import type { Decisions, KeepRule } from '../decisions/types.js';
import { bodyTerms, termsIn } from '../glossary/match.js';
import { finalPrompt } from '../glossary/prompts.js';
import type { Glossary } from '../glossary/types.js';
import type { ProjectMeta } from '../project/project.js';
import { composeSpeaker, splitSpeaker } from '../text/speaker.js';
import type { Issue, TextUnit, TranslationEntry, UnitKind } from '../types.js';

export interface ExchangeLine { speaker: string | null; source: string; target: string | null }
/** A reviewer's remark on the item: still waiting for a look ('대기'), taken ('받음') or passed over ('넘김'). before is the translation it was about, once handled. */
export interface ExchangeReview { problem: string; before?: string; suggestion: string; result: '대기' | '받음' | '넘김' }
export interface ExchangeItem {
  id: string; kind: UnitKind; speaker: string | null; text: string; keep?: string[]; current?: string;
  review?: ExchangeReview;
  before: ExchangeLine[]; after: ExchangeLine[];
}
/** A file handed to an outside translator: everything needed to translate the items, and how to answer. */
export interface ExchangePackage {
  format: 'mvmz-exchange-1'; project: string; sourceLang: string; targetLang: string;
  instructions: string;
  terms: { source: string; target: string }[];
  characters: { name: string; target: string; speech: string; firstPerson?: string; addressing?: string; moanStyle?: string }[];
  items: ExchangeItem[];
  replyFormat: '[{ "id": "...", "target": "..." }]';
}
export interface ImportPlan {
  ok: { id: string; target: string; issues: Issue[] }[];
  conflicts: { id: string; current: string; incoming: string }[];
  unknownIds: string[];
  invalid: number;
}

const CONTEXT = 2;
const CONTEXT_KINDS = new Set<UnitKind>(['dialogue', 'scroll']);
const REPLY_FORMAT = '[{ "id": "...", "target": "..." }]' as const;

/** Speaker, speaker line and body of a unit (speaker lines only in dialogue). */
function parts(u: TextUnit, pattern: string | null): { speaker: string | null; speakerLine: string | null; body: string } {
  const s = splitSpeaker(u.source, u.kind === 'dialogue' ? pattern : null);
  return { speaker: u.speaker ? u.speaker : s.speaker, speakerLine: s.speakerLine, body: s.body };
}

function bodyOf(target: string, speakerLine: string | null): string {
  if (speakerLine === null) return target;
  const nl = target.indexOf('\n');
  return nl < 0 ? target : target.slice(nl + 1);
}

/** Translated name of a speaker: a name term, else a character card, else the name itself. */
function speakerTarget(speaker: string, g: Glossary): string {
  const term = g.terms.find((t) => t.category === 'name' && t.source === speaker && t.target !== '');
  if (term) return term.target;
  const card = g.characters.find((c) => c.source === speaker && c.target !== '');
  return card ? card.target : speaker;
}

/** The keep rule of a unit confirmed as translated, or undefined. */
function keepOf(u: TextUnit, d: Decisions): KeepRule | undefined {
  if (!u.needsDecision) return undefined;
  const dec = confirmedDecisionFor(u, d);
  return dec?.translate ? dec.keep : undefined;
}

/** Builds the exchange package for the given unit ids (in units order). */
export function buildPackage(o: {
  meta: ProjectMeta; units: TextUnit[]; entryOf: (id: string) => TranslationEntry; glossary: Glossary; decisions: Decisions; ids: string[];
}): ExchangePackage {
  const g = o.glossary;
  const pattern = g.rules.speakerPattern;
  const want = new Set(o.ids);
  const byFile = new Map<string, TextUnit[]>();
  for (const u of o.units) {
    const file = u.refs[0]?.file ?? '';
    byFile.set(file, [...(byFile.get(file) ?? []), u]);
  }
  const line = (u: TextUnit): ExchangeLine => {
    const p = parts(u, pattern);
    const t = o.entryOf(u.id).target;
    return { speaker: p.speaker, source: p.body, target: t === null ? null : bodyOf(t, p.speakerLine) };
  };

  const items: ExchangeItem[] = [];
  const speakers = new Set<string>();
  const texts: string[] = [];
  for (const list of byFile.values()) {
    list.forEach((u, index) => {
      if (!want.has(u.id)) return;
      const p = parts(u, pattern);
      const item: ExchangeItem = { id: u.id, kind: u.kind, speaker: p.speaker, text: p.body, before: [], after: [] };
      const keep = keepOf(u, o.decisions);
      const pieces = keep ? keepPieces(u.source, keep) : null;
      if (pieces && pieces.some((x) => x !== '')) item.keep = pieces;
      const entry = o.entryOf(u.id);
      const current = entry.target;
      if (current !== null) item.current = bodyOf(current, p.speakerLine);
      // Why a line reads as it does now: the open remark first, else the last one that was handled.
      if (entry.review) item.review = { problem: entry.review.problem, suggestion: bodyOf(entry.review.suggestion, p.speakerLine), result: '대기' };
      else if (entry.pastReview) {
        const past = entry.pastReview;
        item.review = { problem: past.problem, before: bodyOf(past.before, p.speakerLine), suggestion: bodyOf(past.suggestion, p.speakerLine), result: past.taken === 'suggestion' ? '받음' : '넘김' };
      }
      for (let k = index - 1; k >= 0 && item.before.length < CONTEXT; k--) if (CONTEXT_KINDS.has(list[k].kind)) item.before.unshift(line(list[k]));
      for (let k = index + 1; k < list.length && item.after.length < CONTEXT; k++) if (CONTEXT_KINDS.has(list[k].kind)) item.after.push(line(list[k]));
      items.push(item);
      if (p.speaker) speakers.add(p.speaker);
      texts.push(u.source);
    });
  }

  const found = new Set<string>();
  for (const s of texts) for (const t of termsIn(s, bodyTerms(g.terms))) found.add(t.id);
  const all = texts.join('\n');
  return {
    format: 'mvmz-exchange-1',
    project: o.meta.name,
    sourceLang: o.meta.sourceLang,
    targetLang: o.meta.targetLang,
    instructions: finalPrompt('export', g),
    terms: g.terms.filter((t) => found.has(t.id)).map((t) => ({ source: t.source, target: t.target })),
    characters: g.characters.filter((c) => speakers.has(c.source) || all.includes(c.source)).map((c) => {
      const out: ExchangePackage['characters'][number] = { name: c.source, target: c.target, speech: c.speech };
      if (c.firstPerson) out.firstPerson = c.firstPerson;
      if (c.addressing) out.addressing = c.addressing;
      if (c.moanStyle) out.moanStyle = c.moanStyle;
      return out;
    }),
    items,
    replyFormat: REPLY_FORMAT,
  };
}

/**
 * Sorts returned translations: unknown ids, ones that differ from an existing translation (conflicts),
 * ones equal to it (left out), and new ones (ok, with their check result). Speaker lines are put back first.
 * Malformed entries (or a reply that is not an array) are counted as invalid; nothing throws.
 */
export function planImport(
  units: TextUnit[],
  entryOf: (id: string) => TranslationEntry,
  glossary: Glossary,
  decisions: Decisions,
  items: { id: string; target: string }[],
): ImportPlan {
  const plan: ImportPlan = { ok: [], conflicts: [], unknownIds: [], invalid: 0 };
  if (!Array.isArray(items)) {
    plan.invalid = 1;
    return plan;
  }
  const byId = new Map(units.map((u) => [u.id, u]));
  const g = glossary;
  const seen = new Set<string>();
  for (const raw of items as unknown[]) {
    const it = raw as { id?: unknown; target?: unknown } | null;
    if (!it || typeof it !== 'object' || typeof it.id !== 'string' || typeof it.target !== 'string') {
      plan.invalid++;
      continue;
    }
    const u = byId.get(it.id);
    if (!u) {
      plan.unknownIds.push(it.id);
      continue;
    }
    if (seen.has(u.id)) continue;
    seen.add(u.id);
    const p = parts(u, g.rules.speakerPattern);
    const full = p.speakerLine !== null && p.speaker !== null ? composeSpeaker(p.speakerLine, p.speaker, speakerTarget(p.speaker, g), it.target) : it.target;
    const current = entryOf(u.id).target;
    if (current !== null) {
      if (current !== full) plan.conflicts.push({ id: u.id, current, incoming: full });
      continue;
    }
    const issues = checkTranslation(u, full, g.rules, { terms: g.terms, maxLineWidthChars: g.rules.maxLineWidthChars, speakerPattern: g.rules.speakerPattern }, keepOf(u, decisions));
    plan.ok.push({ id: u.id, target: full, issues });
  }
  return plan;
}
