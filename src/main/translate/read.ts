import { createHash } from 'node:crypto';
import type { TextUnit, UnitKind } from '../../core/types.js';
import { scopeLabel } from '../../shared/rows.js';
import { unitParts } from './batches.js';
import { isMoanLine } from './material.js';

/** One line of the readable script: "speaker: body" (or the body alone), in game order. */
export interface ScriptLine { unitId: string; file: string; speaker: string | null; text: string; moan: boolean }
/** A piece of the script sent in one read call. */
export interface ReadChunk { index: number; lines: string[]; text: string; chars: number; hash: string }

export const SKIP_MARK = '……(중략)……';
const SCRIPT_KINDS = new Set<UnitKind>(['dialogue', 'choice', 'scroll']);
const DEFAULT_CHUNK_CHARS = 20000;
export const DEFAULT_BUDGET_CHARS = 50000;
const DEFAULT_WINDOW_CHARS = 2500;
const DEFAULT_TOP_SPEAKERS = 12;
const MIN_SPEAKER_HITS = 2;

/** Dialogue, choices and scrolling text that are not needsDecision, per file of the first ref, in original order. */
export function scriptLines(units: TextUnit[], pattern: string | null): ScriptLine[] {
  const byFile = new Map<string, ScriptLine[]>();
  for (const u of units) {
    if (u.needsDecision || !SCRIPT_KINDS.has(u.kind)) continue;
    const file = u.refs[0]?.file ?? '';
    const p = unitParts(u, pattern);
    const body = p.body.replace(/\n/g, ' ').trim();
    if (!body) continue;
    const head = u.kind === 'choice' ? '[선택지] ' : p.speaker ? `${p.speaker}: ` : '';
    const list = byFile.get(file) ?? [];
    list.push({ unitId: u.id, file, speaker: p.speaker, text: head + body, moan: p.speaker !== null && isMoanLine(p.body) });
    byFile.set(file, list);
  }
  return [...byFile.values()].flat();
}

function hashOf(text: string): string {
  return createHash('sha1').update(text).digest('hex').slice(0, 16);
}

export function makeChunk(index: number, lines: string[]): ReadChunk {
  const text = lines.join('\n');
  return { index, lines, text, chars: text.length, hash: hashOf(text) };
}

/** Cuts lines into chunks of about maxChars, only between lines. A single longer line is a chunk of its own. */
function cut(lines: string[], maxChars: number): ReadChunk[] {
  const out: ReadChunk[] = [];
  let cur: string[] = [];
  let size = 0;
  for (const l of lines) {
    if (cur.length > 0 && size + l.length + 1 > maxChars) {
      out.push(makeChunk(out.length, cur));
      cur = [];
      size = 0;
    }
    cur.push(l);
    size += l.length + 1;
  }
  if (cur.length > 0) out.push(makeChunk(out.length, cur));
  return out;
}

/** Script lines with a "## <file>" heading wherever the file changes, and the skip mark where lines were left out. */
function withHeadings(all: ScriptLine[], picked: number[]): string[] {
  const out: string[] = [];
  let prev = -2;
  let file: string | null = null;
  for (const i of picked) {
    const l = all[i];
    if (prev >= 0 && i !== prev + 1) out.push(SKIP_MARK);
    if (l.file !== file) {
      out.push(`## ${scopeLabel(l.file)}`);
      file = l.file;
    }
    out.push(l.text);
    prev = i;
  }
  return out;
}

/** The whole script in game order, cut into chunks of about maxChars (default 20,000) at line or file boundaries. */
export function planReadChunks(units: TextUnit[], pattern: string | null, o: { maxChars?: number } = {}): ReadChunk[] {
  const all = scriptLines(units, pattern);
  return cut(withHeadings(all, all.map((_, i) => i)), o.maxChars ?? DEFAULT_CHUNK_CHARS);
}

/** Line index ranges [start, end) of windows of about windowChars starting at line `from`. */
function windowAt(all: ScriptLine[], from: number, windowChars: number): [number, number] {
  let end = from;
  let size = 0;
  while (end < all.length && (size < windowChars || end === from)) size += all[end++].text.length + 1;
  return [from, end];
}

/** Index of the line holding character offset `at` of the joined script. */
function lineAt(starts: number[], at: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= at) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/**
 * Representative windows of the script for the 'balanced' draft: evenly spread windows within the budget,
 * plus one window for each top speaker seen fewer than twice and one with a moan line for each speaker who has them.
 * Returns the windows as line ranges (for tests) and the chosen line indexes.
 */
export function pickWindows(all: ScriptLine[], o: { budgetChars?: number; windowChars?: number; topSpeakers?: number } = {}): { windows: [number, number][]; picked: number[] } {
  const budget = o.budgetChars ?? DEFAULT_BUDGET_CHARS;
  const win = o.windowChars ?? DEFAULT_WINDOW_CHARS;
  const starts: number[] = [];
  let total = 0;
  for (const l of all) {
    starts.push(total);
    total += l.text.length + 1;
  }
  if (all.length === 0) return { windows: [], picked: [] };
  if (total <= budget) return { windows: [[0, all.length]], picked: all.map((_, i) => i) };

  const windows: [number, number][] = [];
  const n = Math.max(1, Math.floor(budget / win));
  for (let k = 0; k < n; k++) {
    const at = n === 1 ? 0 : Math.round((k * Math.max(0, total - win)) / (n - 1));
    windows.push(windowAt(all, lineAt(starts, at), win));
  }
  const chosen = () => {
    const s = new Set<number>();
    for (const [a, b] of windows) for (let i = a; i < b; i++) s.add(i);
    return s;
  };

  // Top speakers: each should show up at least twice.
  const counts = new Map<string, number>();
  for (const l of all) if (l.speaker) counts.set(l.speaker, (counts.get(l.speaker) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, o.topSpeakers ?? DEFAULT_TOP_SPEAKERS).map(([s]) => s);
  for (const sp of top) {
    const s = chosen();
    let seen = 0;
    for (const i of s) if (all[i].speaker === sp) seen++;
    if (seen >= MIN_SPEAKER_HITS) continue;
    // The window (by line start) where this speaker talks the most.
    let best = 0;
    let bestHits = -1;
    let hits = 0;
    let b = 0;
    let size = 0;
    for (let a = 0; a < all.length; a++) {
      while (b < all.length && size < win) {
        size += all[b].text.length + 1;
        if (all[b].speaker === sp) hits++;
        b++;
      }
      if (hits > bestHits) {
        bestHits = hits;
        best = a;
      }
      size -= all[a].text.length + 1;
      if (all[a].speaker === sp) hits--;
    }
    windows.push(windowAt(all, best, win));
  }

  // Speakers with moan lines: at least one such line is read.
  const moanSpeakers = new Map<string, number[]>();
  all.forEach((l, i) => {
    if (l.moan && l.speaker) moanSpeakers.set(l.speaker, [...(moanSpeakers.get(l.speaker) ?? []), i]);
  });
  for (const [, idx] of moanSpeakers) {
    const s = chosen();
    if (idx.some((i) => s.has(i))) continue;
    const mid = idx[Math.floor(idx.length / 2)];
    // Start a little before the line so the scene around it is visible.
    let from = mid;
    let back = 0;
    while (from > 0 && back < win / 3) back += all[--from].text.length + 1;
    windows.push(windowAt(all, from, win));
  }

  return { windows, picked: [...chosen()].sort((a, b) => a - b) };
}

/** The 'balanced' draft's reading: representative windows joined in game order, cut into chunks of about maxChars. */
export function pickExcerpts(
  units: TextUnit[],
  pattern: string | null,
  o: { budgetChars?: number; windowChars?: number; topSpeakers?: number; maxChars?: number } = {},
): ReadChunk[] {
  const all = scriptLines(units, pattern);
  const { picked } = pickWindows(all, o);
  return cut(withHeadings(all, picked), o.maxChars ?? DEFAULT_CHUNK_CHARS);
}

// ---- one read call ----------------------------------------------------------------------------

export interface ReadNote {
  characters: { name: string; traits: string; speech: string; moans: string; firstPerson?: string; addressing?: string }[];
  terms: { source: string; kind: 'name' | 'place' | 'term'; note: string }[];
  sfx: { source: string; note: string }[];
  style: string;
}

export const READ_SCHEMA = {
  type: 'object',
  properties: {
    characters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' }, traits: { type: 'string' }, speech: { type: 'string' }, moans: { type: 'string' },
          firstPerson: { type: 'string' }, addressing: { type: 'string' },
        },
        required: ['name', 'traits', 'speech', 'moans'],
      },
    },
    terms: {
      type: 'array',
      items: { type: 'object', properties: { source: { type: 'string' }, kind: { type: 'string', enum: ['name', 'place', 'term'] }, note: { type: 'string' } }, required: ['source', 'kind', 'note'] },
    },
    sfx: { type: 'array', items: { type: 'object', properties: { source: { type: 'string' }, note: { type: 'string' } }, required: ['source', 'note'] } },
    style: { type: 'string' },
  },
  required: ['characters', 'terms', 'sfx', 'style'],
} as const;

const s = (v: unknown): v is string => typeof v === 'string';
const os = (v: unknown) => v === undefined || typeof v === 'string';

export function isReadNote(v: unknown): v is ReadNote {
  if (!v || typeof v !== 'object') return false;
  const n = v as any;
  return Array.isArray(n.characters) && Array.isArray(n.terms) && Array.isArray(n.sfx) && s(n.style)
    && n.characters.every((c: any) => c && s(c.name) && s(c.traits) && s(c.speech) && s(c.moans) && os(c.firstPerson) && os(c.addressing))
    && n.terms.every((t: any) => t && s(t.source) && ['name', 'place', 'term'].includes(t.kind) && s(t.note))
    && n.sfx.every((x: any) => x && s(x.source) && s(x.note));
}

export function buildReadPrompt(chunk: ReadChunk, known: { name: string; summary: string }[]): { system: string; user: string } {
  const system = [
    '너는 RPG Maker 게임의 번역을 준비하려고 대본을 읽는다.',
    '입력(JSON): script 는 대본의 한 부분이다. 한 줄이 대사 하나이고 "화자: 본문" 꼴이며, 화자가 없으면 지문이다. "## " 줄은 장소(파일)이고, "……(중략)……" 은 사이를 건너뛴 자리다. known 은 앞 부분까지 나온 인물 요약이다. 같은 인물은 known 의 이름을 그대로 쓴다.',
    '',
    '할 일:',
    '- 대본의 이 부분을 읽고, 나온 인물마다 성격(traits)·말투(speech)·신음과 감탄 소리의 결(moans)을 원문 근거와 함께 짧게 적는다. 1인칭(firstPerson)과 남을 부르는 말(addressing)이 보이면 적는다.',
    '- 고유명사(terms: 인물 이름 name, 지명 place, 그 밖의 용어 term)와 효과음(sfx: 사물·동작 소리)을 원문 그대로 뽑고 note 에 무엇인지 적는다.',
    '- 문체와 분위기에서 눈에 띄는 점을 style 에 적는다.',
    '- 번역은 아직 하지 않는다. 메모는 한국어로 짧게 쓴다.',
  ].join('\n');
  return { system, user: JSON.stringify({ known, script: chunk.text }) };
}

// ---- merging notes ----------------------------------------------------------------------------

export interface ReadSummary {
  characters: { name: string; traits: string; speech: string; moans: string; firstPerson?: string; addressing?: string }[];
  terms: { source: string; kind: 'name' | 'place' | 'term'; note: string }[];
  sfx: { source: string; note: string }[];
  style: string;
}

const CHARACTER_MAX = 1500;
const NOTE_MAX = 300;
const STYLE_MAX = 3000;

function joinNotes(parts: string[], max: number): string {
  // Later notes win when it gets too long.
  const kept: string[] = [];
  let size = 0;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i].trim();
    if (!p || kept.includes(p)) continue;
    if (size + p.length > max) break;
    kept.unshift(p);
    size += p.length + 3;
  }
  return kept.join(' / ');
}

/** Gathers the per-chunk notes by character name and term source. Each character stays under 1,500 characters, later chunks first. */
export function mergeReadNotes(notes: ReadNote[]): ReadSummary {
  const chars = new Map<string, ReadNote['characters']>();
  const terms = new Map<string, { kind: ReadNote['terms'][number]['kind']; notes: string[] }>();
  const sfx = new Map<string, string[]>();
  for (const n of notes) {
    for (const c of n.characters) {
      const name = c.name.trim();
      if (name) chars.set(name, [...(chars.get(name) ?? []), c]);
    }
    for (const t of n.terms) {
      const src = t.source.trim();
      if (!src) continue;
      const e = terms.get(src) ?? { kind: t.kind, notes: [] };
      e.notes.push(t.note);
      terms.set(src, e);
    }
    for (const x of n.sfx) {
      const src = x.source.trim();
      if (src) sfx.set(src, [...(sfx.get(src) ?? []), x.note]);
    }
  }
  const characters: ReadSummary['characters'] = [];
  for (const [name, list] of chars) {
    // Budget per field, taken from the newest notes first; the three main fields share the 1,500 characters.
    const third = Math.floor(CHARACTER_MAX / 3);
    const c: ReadSummary['characters'][number] = {
      name,
      traits: joinNotes(list.map((x) => x.traits), third),
      speech: joinNotes(list.map((x) => x.speech), third),
      moans: joinNotes(list.map((x) => x.moans), third),
    };
    const fp = [...list].reverse().find((x) => x.firstPerson?.trim())?.firstPerson?.trim();
    const ad = [...list].reverse().find((x) => x.addressing?.trim())?.addressing?.trim();
    if (fp) c.firstPerson = fp;
    if (ad) c.addressing = ad;
    characters.push(c);
  }
  return {
    characters,
    terms: [...terms.entries()].map(([source, e]) => ({ source, kind: e.kind, note: joinNotes(e.notes, NOTE_MAX) })),
    sfx: [...sfx.entries()].map(([source, n]) => ({ source, note: joinNotes(n, NOTE_MAX) })),
    style: joinNotes(notes.map((n) => n.style), STYLE_MAX),
  };
}

/** One line per character for the next read call, so names stay the same. */
export function knownSummary(summary: ReadSummary): { name: string; summary: string }[] {
  return summary.characters.map((c) => ({ name: c.name, summary: c.traits.slice(0, 120) }));
}

/** Splits a chunk in two at a line boundary (null when it has a single line). */
export function splitChunk(c: ReadChunk): [ReadChunk, ReadChunk] | null {
  if (c.lines.length < 2) return null;
  const half = Math.ceil(c.lines.length / 2);
  return [makeChunk(c.index, c.lines.slice(0, half)), makeChunk(c.index, c.lines.slice(half))];
}
