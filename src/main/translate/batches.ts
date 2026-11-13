import { termsIn } from '../../core/glossary/match.js';
import type { Glossary, ProjectRules, Term } from '../../core/glossary/types.js';
import { splitSpeaker } from '../../core/text/speaker.js';
import type { TextUnit, TranslationEntry, TranslationStatus, UnitKind } from '../../core/types.js';
import { scopeLabel } from '../../shared/rows.js';
import { keepPieces } from '../../core/decisions/keys.js';
import { confirmedDecisionFor, isTranslatable } from '../../core/decisions/store.js';
import type { Decisions } from '../../core/decisions/types.js';

/** One unit as sent to the model. text is the body with the speaker line taken off. */
export interface BatchItem { i: number; id: string; kind: UnitKind; speaker: string | null; speakerLine: string | null; text: string; keep?: string[] }
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

/** The format rules written out for the model. */
export function formatRulesText(rules: ProjectRules): string[] {
  const out: string[] = [];
  if (rules.controlCodes) out.push('- 제어문자(\\C[2], \\N[1], \\V[3], \\{, \\. 같은 것)와 %1 같은 자리표시는 종류와 개수를 원문 그대로 둔다. 색 코드는 원문에서 감싸던 말과 같은 말을 감싸게 한다.');
  if (rules.noLeftoverJapanese) out.push('- 번역문에 일본어 글자(가나, 한자)를 남기지 않는다.');
  out.push('- text 안의 줄바꿈은 번역에서도 실제 줄바꿈으로 둔다. 역슬래시와 n 두 글자로 바꿔 쓰지 않는다.');
  if (rules.sameLineCount) out.push('- 줄 수를 원문과 똑같이 맞춘다.');
  if (rules.maxLines !== null) out.push(`- 대사(kind 가 dialogue)는 ${rules.maxLines}줄을 넘기지 않는다.`);
  if (rules.maxLineWidthChars !== null) out.push(`- 한 줄은 한글 ${rules.maxLineWidthChars}자를 넘기지 않는다(영문, 숫자, 공백은 0.5자로 센다). 넘치면 줄을 나눈다.`);
  return out;
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
  const system = [
    '너는 RPG Maker 게임의 원문을 아래 번역 지침에 따라 번역한다.',
    '',
    '<번역 지침>',
    glossary.styleGuide.trim(),
    '</번역 지침>',
    '',
    '형식 규칙:',
    ...formatRulesText(glossary.rules),
    '',
    '입력(JSON):',
    '- terms: 이 묶음에 나오는 용어. 원문에 source 가 있으면 반드시 target 으로 옮긴다.',
    '- characters: 이 묶음에 나오는 인물. name 은 원문 이름, target 은 번역 이름, speech 는 말투다. 그 인물의 대사는 이 말투를 따른다. moanStyle 이 있으면 그 인물의 신음·감탄 소리는 그 결을 따른다.',
    '- context: 이 묶음 바로 앞의 대사(참고만 하고 번역해서 돌려주지 않는다). target 이 있으면 이미 번역된 것이다.',
    '- items: 번역할 항목. speaker 는 그 대사를 말하는 인물이다.',
    '- 항목에 previous 와 problems 가 있으면 직전 번역이 검사에 걸린 것이다. problems 를 고쳐 다시 옮긴다.',
    '',
    '출력 규칙:',
    '- 항목마다 i 와 번역 t 를 돌려준다. 모든 항목을 빠짐없이 돌려준다.',
    '- 번역할 수 없는 항목은 t 를 null 로 하고 declined 에 이유를 적는다.',
    '- 용어집에 없는 고유명사를 새로 옮겼으면 그 항목의 newTerms 에 source(원문)와 target(번역)을 적는다.',
    '- 화자 이름은 번역하지 않는다. text 의 본문만 옮긴다.',
    '- keep 이 있으면 그 글들은 한 글자도 바꾸지 않고 같은 순서로 남긴다. text 전체를 돌려주되 그 사이의 글자만 번역한다.',
  ].join('\n');

  const speakers = speakersOf(batch);
  const user = {
    terms: batchTerms(batch, glossary.terms).map((t) => ({ source: t.source, target: t.target })),
    characters: glossary.characters.filter((c) => speakers.has(c.source)).map((c) => {
      const out: Record<string, string> = { name: c.source, target: c.target, speech: c.speech };
      if (c.firstPerson) out.firstPerson = c.firstPerson;
      if (c.addressing) out.addressing = c.addressing;
      if (c.moanStyle) out.moanStyle = c.moanStyle;
      return out;
    }),
    context: batch.context,
    items: batch.items.map((i) => ({ i: i.i, kind: i.kind, speaker: i.speaker, text: i.text, ...(i.keep ? { keep: i.keep } : {}) })),
  };
  return { system, user: JSON.stringify(user) };
}
