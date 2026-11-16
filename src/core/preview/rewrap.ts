// Moves line breaks so a translation fits its game window. Only the places of line breaks change: a break goes
// where a space was (the space goes), and lines flowed together get a space where the break was. Every other
// character stays as it is, so codes, names and wording are never touched. Nothing here knows about fonts: the
// caller gives the window's layout (src/core/preview/layout.ts with the game font).
import { splitSpeaker } from '../text/speaker.js';
import type { Layout } from './types.js';

/** The window a text is fitted to. layout lays out the whole text; maxLines is how many lines the window shows. */
export interface RewrapWindow { layout: (text: string) => Layout; maxLines: number; speakerPattern?: string | null }
/** no-break: a line has no space it can be broken at (or its first word alone is too wide); too-many-lines: it fits only in more lines than the window shows. */
export type RewrapFailure = 'no-break' | 'too-many-lines';
/** ok with changed false: the text already fits and is given back as it is. Not ok: the text is given back as it is. */
export type RewrapResult = { ok: true; text: string; changed: boolean } | { ok: false; text: string; reason: RewrapFailure };

const CODE_SRC = String.raw`\\[Nn][1-5CcRr]?<[^>\r\n]*>|\\[A-Za-z]+(?:\[[^\]\r\n]*\])?|\\[{}.|!><^$\\]`;
const CODE = new RegExp(CODE_SRC, 'g');
const ONLY_CODES = new RegExp(`^(?:${CODE_SRC})+$`);
const TRAILING_CODES = new RegExp(`(?:${CODE_SRC})+$`);
/** A line may end after these: the reader pauses there anyway. */
const PAUSE = /[,.?!…~)\]}）」』】〕〉》”’"'♡♥♪、。，．！？―-]$/;
/** A last line this short (letters and digits, not counting codes and punctuation) looks like a leftover. */
const SHORT_TAIL = 3;
/** A pause earlier than this share of the width would leave the line too short to be worth it. */
const PAUSE_MIN_SHARE = 0.5;

const visible = (s: string): string => s.replace(CODE, '').replace(/\s/g, '');

/** Positions of spaces a line can be broken at: outside codes, with something to show on both sides. */
function breakPoints(line: string): number[] {
  const inCode = new Uint8Array(line.length);
  for (const m of line.matchAll(CODE)) inCode.fill(1, m.index, m.index + m[0].length);
  const out: number[] = [];
  for (let i = 0; i < line.length; i++) {
    if (line[i] !== ' ' || inCode[i]) continue;
    if (visible(line.slice(0, i)) !== '' && visible(line.slice(i + 1)) !== '') out.push(i);
  }
  return out;
}

function endsWithPause(prefix: string): boolean {
  return PAUSE.test(prefix.replace(TRAILING_CODES, '').trimEnd());
}

// Letters and digits only: "즐겼다." left alone on a line is as much a leftover as "즐겼다".
const isShort = (s: string): boolean => [...visible(s)].filter((ch) => /[\p{L}\p{N}]/u.test(ch)).length <= SHORT_TAIL;

/** Lines flowed into one: a space where a break was, unless a space or an empty line is already there. */
function joinLines(lines: string[]): string {
  let out = lines[0] ?? '';
  for (const next of lines.slice(1)) {
    out = out === '' || next === '' || /\s$/.test(out) || /^\s/.test(next) ? out + next : `${out} ${next}`;
  }
  return out;
}

export function rewrapText(text: string, w: RewrapWindow): RewrapResult {
  const overflows = (l: Layout) => l.lines.length > w.maxLines || l.lines.some((x) => x.overflow > 0);
  const first = w.layout(text);
  if (!overflows(first)) return { ok: true, text, changed: false };
  const available = first.available;
  /** Width of the last line, laid out after the lines before it (colors and sizes carry over lines). */
  const widthAfter = (before: string[], line: string): number => w.layout([...before, line].join('\n')).lines.at(-1)!.width;

  /** One line cut into pieces that each fit, or null when it cannot be cut. */
  const split = (before: string[], line: string): string[] | null => {
    const pieces: string[] = [];
    let rest = line;
    while (widthAfter([...before, ...pieces], rest) > available) {
      const ahead = [...before, ...pieces];
      const fits = breakPoints(rest).map((k) => ({ k, width: widthAfter(ahead, rest.slice(0, k)) })).filter((c) => c.width <= available);
      if (fits.length === 0) return null;
      const pauses = fits.filter((c) => c.width >= available * PAUSE_MIN_SHARE && endsWithPause(rest.slice(0, c.k)));
      const k = (pauses.at(-1) ?? fits.at(-1)!).k;
      pieces.push(rest.slice(0, k));
      rest = rest.slice(k + 1);
    }
    pieces.push(rest);
    // A leftover word or two on the last line: break the last two pieces somewhere else if both still fit.
    if (pieces.length >= 2 && isShort(rest)) {
      const ahead = [...before, ...pieces.slice(0, -2)];
      const both = `${pieces.at(-2)} ${rest}`;
      const better = breakPoints(both).filter((k) => !isShort(both.slice(k + 1))
        && widthAfter(ahead, both.slice(0, k)) <= available && widthAfter([...ahead, both.slice(0, k)], both.slice(k + 1)) <= available).at(-1);
      if (better !== undefined) pieces.splice(-2, 2, both.slice(0, better), both.slice(better + 1));
    }
    return pieces;
  };

  // The speaker line (or a first line of codes only, such as a name box) stays first and is never broken.
  const said = splitSpeaker(text, w.speakerPattern ?? null);
  const nl = text.indexOf('\n');
  const head = said.speakerLine ?? (nl > 0 && ONLY_CODES.test(text.slice(0, nl)) ? text.slice(0, nl) : null);
  const heads = head === null ? [] : [head];
  const lines = (head === null ? text : text.slice(head.length + 1)).split('\n');
  const done = (body: string[]): RewrapResult | null => {
    const t = [...heads, ...body].join('\n');
    return overflows(w.layout(t)) ? null : { ok: true, text: t, changed: t !== text };
  };

  // First only the lines that are too wide are cut; the others keep their breaks.
  let cut: string[] | null = [];
  for (const line of lines) {
    const before = [...heads, ...cut];
    if (widthAfter(before, line) <= available) {
      cut.push(line);
      continue;
    }
    const pieces = split(before, line);
    if (!pieces) {
      cut = null;
      break;
    }
    cut.push(...pieces);
  }
  const kept = cut && done(cut);
  if (kept) return kept;

  // Too many lines that way: the whole text is flowed again from the start.
  const flowed = split(heads, joinLines(lines));
  const again = flowed && done(flowed);
  if (again) return again;
  return { ok: false, text, reason: cut || flowed ? 'too-many-lines' : 'no-break' };
}
