import { noteKey } from '../decisions/keys.js';
import { hasJapanese } from '../text/japanese.js';
import type { PathSeg } from '../types.js';
import type { RawUnit } from './events.js';

/** '<tag>…</tag>' (several lines) or '<tag:value>'. */
const TAG = /<([^<>:\s/]+)>([\s\S]*?)<\/\1>|<([^<>:\s/]+):([^<>]*)>/g;

interface TagValue { tag: string; index: number; start: number; end: number }

/** Every tag value in the note, in order; index counts the tag's earlier occurrences. Multi-line values lose one leading and trailing line break. */
function tagValues(note: string): TagValue[] {
  const out: TagValue[] = [];
  const seen = new Map<string, number>();
  for (const m of note.matchAll(TAG)) {
    const tag = m[1] ?? m[3];
    const index = seen.get(tag) ?? 0;
    seen.set(tag, index + 1);
    if (m[1] !== undefined) {
      const innerStart = m.index + m[1].length + 2;
      let start = innerStart;
      let end = innerStart + m[2].length;
      const lead = /^\r?\n/.exec(m[2]);
      if (lead) start += lead[0].length;
      const trail = /\r?\n$/.exec(note.slice(start, end));
      if (trail) end -= trail[0].length;
      out.push({ tag, index, start, end });
    } else {
      const start = m.index + m[3].length + 2;
      out.push({ tag, index, start, end: start + m[4].length });
    }
  }
  return out;
}

/** 'data/Items.json' -> 'Items', 'data/Map012.json' -> 'Map'. */
function fileKind(file: string): string {
  const name = file.replace(/^.*\//, '').replace(/\.json$/i, '');
  return /^Map\d+$/i.test(name) ? 'Map' : name;
}

/** Japanese values of '<tag:value>' and '<tag>…</tag>' in a note field. Text outside tags is not extracted. */
export function extractNotes(note: string, file: string, path: PathSeg[]): RawUnit[] {
  if (typeof note !== 'string' || note === '') return [];
  const out: RawUnit[] = [];
  for (const v of tagValues(note)) {
    const source = note.slice(v.start, v.end);
    if (!hasJapanese(source)) continue;
    out.push({ kind: 'note', source, needsDecision: true, decisionKey: noteKey(fileKind(file), v.tag), ref: { type: 'note', file, path: [...path], tag: v.tag, index: v.index } });
  }
  return out;
}

/** The note with the value of the index-th tag replaced by value (taken literally). Unchanged when there is no such tag. */
export function replaceNoteValue(note: string, tag: string, index: number, value: string): string {
  const v = tagValues(note).find((x) => x.tag === tag && x.index === index);
  if (!v) return note;
  return note.slice(0, v.start) + value + note.slice(v.end);
}
