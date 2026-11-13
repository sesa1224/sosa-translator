// Hands sentences to an outside translator and takes the reply back. buildPackage writes a self-contained JSON
// file (glossary, characters, context lines, reply format); planImport sorts a reply into new translations,
// conflicts with existing ones and unknown ids before anything is written (ProjectService.applyImport writes).
import { checkTranslation } from '../check/format.js';
import { keepPieces } from '../decisions/keys.js';
import { confirmedDecisionFor } from '../decisions/store.js';
import type { Decisions, KeepRule } from '../decisions/types.js';
import { termsIn } from '../glossary/match.js';
import type { Glossary } from '../glossary/types.js';
import type { ProjectMeta } from '../project/project.js';
import { composeSpeaker, splitSpeaker } from '../text/speaker.js';
import type { Issue, TextUnit, TranslationEntry, UnitKind } from '../types.js';

export interface ExchangeLine { speaker: string | null; source: string; target: string | null }
export interface ExchangeItem {
  id: string; kind: UnitKind; speaker: string | null; text: string; keep?: string[]; current?: string;
  before: ExchangeLine[]; after: ExchangeLine[];
}
/** A file handed to an outside translator: everything needed to translate the items, and how to answer. */
export interface ExchangePackage {
  format: 'mvmz-exchange-1'; project: string; sourceLang: string; targetLang: string;
  instructions: string;
  terms: { source: string; target: string }[];
  characters: { name: string; target: string; speech: string; moanStyle?: string }[];
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

function instructionsText(g: Glossary): string {
  const rules: string[] = [];
  if (g.rules.controlCodes) rules.push('- 제어문자(\\C[2], \\N[1], \\V[3], \\{, \\. 같은 것)와 %1 같은 자리표시는 종류와 개수를 원문 그대로 둔다.');
  if (g.rules.noLeftoverJapanese) rules.push('- 번역문에 일본어 글자(가나, 한자)를 남기지 않는다.');
  rules.push('- text 안의 줄바꿈은 번역에서도 줄바꿈으로 둔다.');
  if (g.rules.sameLineCount) rules.push('- 줄 수를 원문과 똑같이 맞춘다.');
  if (g.rules.maxLines !== null) rules.push(`- 대사(kind 가 dialogue)는 ${g.rules.maxLines}줄을 넘기지 않는다.`);
  if (g.rules.maxLineWidthChars !== null) rules.push(`- 한 줄은 한글 ${g.rules.maxLineWidthChars}자를 넘기지 않는다(영문, 숫자, 공백은 0.5자).`);
  rules.push('- keep 이 있는 항목은 keep 의 글들을 한 글자도 바꾸지 않고 같은 순서로 남긴다. text 전체를 돌려주되 그 사이의 글자만 번역한다.');
  rules.push('- 용어(terms)의 source 가 원문에 있으면 target 으로 옮긴다. 인물(characters)의 대사는 speech 의 말투를 따른다.');
  return [
    '<번역 지침>',
    g.styleGuide.trim(),
    '</번역 지침>',
    '',
    '형식 규칙:',
    ...rules,
    '',
    '돌려줄 형식: items 의 항목마다 { "id": 그 항목의 id, "target": text 의 번역 } 을 담은 JSON 배열. 화자 이름(speaker)은 번역하지 않고 text 만 옮긴다.',
    'before/after 는 앞뒤 대사로 참고만 한다.',
  ].join('\n');
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
      const current = o.entryOf(u.id).target;
      if (current !== null) item.current = bodyOf(current, p.speakerLine);
      for (let k = index - 1; k >= 0 && item.before.length < CONTEXT; k--) if (CONTEXT_KINDS.has(list[k].kind)) item.before.unshift(line(list[k]));
      for (let k = index + 1; k < list.length && item.after.length < CONTEXT; k++) if (CONTEXT_KINDS.has(list[k].kind)) item.after.push(line(list[k]));
      items.push(item);
      if (p.speaker) speakers.add(p.speaker);
      texts.push(u.source);
    });
  }

  const found = new Set<string>();
  for (const s of texts) for (const t of termsIn(s, g.terms)) found.add(t.id);
  const all = texts.join('\n');
  return {
    format: 'mvmz-exchange-1',
    project: o.meta.name,
    sourceLang: o.meta.sourceLang,
    targetLang: o.meta.targetLang,
    instructions: instructionsText(g),
    terms: g.terms.filter((t) => found.has(t.id)).map((t) => ({ source: t.source, target: t.target })),
    characters: g.characters.filter((c) => speakers.has(c.source) || all.includes(c.source)).map((c) => {
      const out: ExchangePackage['characters'][number] = { name: c.source, target: c.target, speech: c.speech };
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
