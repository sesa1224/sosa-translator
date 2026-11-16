import { noteKey } from '../decisions/keys.js';
import { hasJapanese } from '../text/japanese.js';
import type { PathSeg } from '../types.js';
import type { RawUnit } from './events.js';

/**
 * '<tag>…</tag>' (several lines), '<tag:value>', or '<tag condition>…</tag>' (a status plugin's
 * '<profile Switch: 704>', one per switch). The condition sits on the opening line and must start with a space, so
 * '<CustomStat: ona=0>' stays a value tag. A conditional block may not run past another opening of its own name:
 * an unclosed one is skipped instead of swallowing the next block.
 */
const TAG = /<([^<>:\s/]+)>([\s\S]*?)<\/\1>|<([^<>:\s/]+):([^<>]*)>|<([^<>:\s/]+)([ \t][^<>\r\n]*)>((?:(?!<\5[\s>])[\s\S])*?)<\/\5>/g;

interface TagValue {
  /** What the ref names: the tag name, or name and condition for a conditional block. */
  tag: string;
  /** The tag name alone, for the decision key: a decision on '<profile>' also covers '<profile Switch: 704>'. */
  name: string;
  index: number;
  start: number;
  end: number;
}

/** Bounds of a block's inner text, without one leading and one trailing line break. */
function innerBounds(note: string, innerStart: number, length: number): { start: number; end: number } {
  let start = innerStart;
  let end = innerStart + length;
  const lead = /^\r?\n/.exec(note.slice(start, end));
  if (lead) start += lead[0].length;
  const trail = /\r?\n$/.exec(note.slice(start, end));
  if (trail) end -= trail[0].length;
  return { start, end };
}

/** Every tag value in the note, in order; index counts the tag's earlier occurrences. Multi-line values lose one leading and trailing line break. */
function tagValues(note: string): TagValue[] {
  const out: TagValue[] = [];
  const seen = new Map<string, number>();
  const push = (tag: string, name: string, b: { start: number; end: number }) => {
    const index = seen.get(tag) ?? 0;
    seen.set(tag, index + 1);
    out.push({ tag, name, index, ...b });
  };
  for (const m of note.matchAll(TAG)) {
    if (m[1] !== undefined) {
      push(m[1], m[1], innerBounds(note, m.index + m[1].length + 2, m[2].length));
    } else if (m[3] !== undefined) {
      const start = m.index + m[3].length + 2;
      push(m[3], m[3], { start, end: start + m[4].length });
    } else {
      const tag = m[5] + m[6];
      push(tag, m[5], innerBounds(note, m.index + tag.length + 2, m[7].length));
    }
  }
  return out;
}

/** 'data/Items.json' -> 'Items', 'data/Map012.json' -> 'Map'. */
function fileKind(file: string): string {
  const name = file.replace(/^.*\//, '').replace(/\.json$/i, '');
  return /^Map\d+$/i.test(name) ? 'Map' : name;
}

/** Japanese values of '<tag:value>', '<tag>…</tag>' and '<tag condition>…</tag>' in a note field. Text outside tags is not extracted. */
export function extractNotes(note: string, file: string, path: PathSeg[]): RawUnit[] {
  if (typeof note !== 'string' || note === '') return [];
  const out: RawUnit[] = [];
  for (const v of tagValues(note)) {
    const source = note.slice(v.start, v.end);
    if (!hasJapanese(source)) continue;
    out.push({ kind: 'note', source, needsDecision: true, decisionKey: noteKey(fileKind(file), v.name), ref: { type: 'note', file, path: [...path], tag: v.tag, index: v.index } });
  }
  return out;
}

/** The tag whose value holds the text from offset to end, as a note ref names it; undefined outside every tag value. */
export function noteTagAt(note: string, offset: number, end: number): { tag: string; index: number } | undefined {
  const v = tagValues(note).find((x) => offset >= x.start && end <= x.end);
  return v ? { tag: v.tag, index: v.index } : undefined;
}

/** The note with the value of the index-th tag replaced by value (taken literally). Unchanged when there is no such tag. */
export function replaceNoteValue(note: string, tag: string, index: number, value: string): string {
  const v = tagValues(note).find((x) => x.tag === tag && x.index === index);
  if (!v) return note;
  return note.slice(0, v.start) + value + note.slice(v.end);
}
