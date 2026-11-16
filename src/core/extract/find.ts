// Finds where a piece of text sits in an original copy, for the chat: text seen on screen that is not a
// translation unit is looked up here instead of guessed at. Whole strings equal to the text come first; strings
// that only contain it (a phrase inside a long note field, say) follow, since screen text is often a piece of one.
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PathSeg, UnitRef } from '../types.js';
import { readJsonFile } from '../util/json.js';
import { noteTagAt } from './notes.js';
import { headerBlockRanges } from './pluginMeta.js';
import { extractFromPlugins, forEachPluginString, parsePluginsFile } from './plugins.js';

/**
 * One place the text was found. Plugin parameter places carry the ref an extracted unit would have, so the caller
 * can tell whether it is a unit already; file places only say how many times. Part places are strings that contain
 * the text without being equal to it, with a short snippet around it instead of the whole string; inside a note
 * tag's value they name the tag and its index, as a note ref would.
 */
export type GameTextPlace =
  | { where: 'plugin-value'; plugin: string; setting: string; ref: UnitRef }
  | { where: 'plugin-key'; plugin: string; setting: string; ref: UnitRef }
  | { where: 'plugin-js'; file: string; count: number }
  | { where: 'data'; file: string; count: number }
  | { where: 'plugin-value-part'; plugin: string; setting: string; ref: UnitRef; snippet: string }
  | { where: 'data-part'; file: string; path: PathSeg[]; snippet: string; note?: { tag: string; index: number } };

/** Shorter text is not looked for inside strings: it would be inside far too many. */
export const FIND_PART_MIN_LENGTH = 3;

/** Characters of context kept on each side of the text in a part place. */
const SNIPPET_SIDE = 30;

const segKey = (s: PathSeg): string | number => (typeof s === 'object' ? s.key : s);

function snippet(s: string, at: number, length: number): string {
  const from = Math.max(0, at - SNIPPET_SIDE);
  const to = Math.min(s.length, at + length + SNIPPET_SIDE);
  return (from > 0 ? '…' : '') + s.slice(from, to) + (to < s.length ? '…' : '');
}

async function readPlugins(root: string): Promise<unknown[] | null> {
  const file = path.join(root, 'js', 'plugins.js');
  if (!existsSync(file)) return null;
  try {
    return parsePluginsFile(await readFile(file, 'utf8')).plugins;
  } catch {
    return null;
  }
}

/** Places in plugins.js: parameter values equal to text, and key names equal to text inside parameter values. */
async function pluginPlaces(plugins: unknown[] | null, text: string): Promise<GameTextPlace[]> {
  if (!plugins) return [];
  // The extractor with text as an extra string finds the same places, with the same refs, as a later extraction would.
  return extractFromPlugins(plugins, { extraStrings: [text] })
    .filter((r) => r.source === text && (r.ref.type === 'value' || r.ref.type === 'key'))
    .map((r) => {
      const p = (r.ref as Extract<UnitRef, { type: 'value' | 'key' }>).path;
      const entry = plugins[Number(segKey(p[0]))] as { name?: unknown } | undefined;
      return {
        where: r.ref.type === 'key' ? 'plugin-key' as const : 'plugin-value' as const,
        plugin: typeof entry?.name === 'string' ? entry.name : String(segKey(p[0])),
        setting: String(segKey(p[2] ?? '')),
        ref: r.ref,
      };
    });
}

/** How many times text is a whole string literal in code (outside the header comments). */
export function countJsLiterals(js: string, text: string): number {
  const blocks = headerBlockRanges(js);
  let n = 0;
  for (const q of ['"', "'", '`']) {
    const needle = q + text + q;
    for (let at = js.indexOf(needle); at >= 0; at = js.indexOf(needle, at + 1)) {
      if (!blocks.some((b) => at >= b.start && at < b.end)) n++;
    }
  }
  return n;
}

async function jsPlaces(root: string, text: string): Promise<GameTextPlace[]> {
  const dir = path.join(root, 'js', 'plugins');
  if (!existsSync(dir)) return [];
  const out: GameTextPlace[] = [];
  for (const name of (await readdir(dir)).filter((n) => n.toLowerCase().endsWith('.js')).sort()) {
    const count = countJsLiterals(await readFile(path.join(dir, name), 'utf8'), text);
    if (count > 0) out.push({ where: 'plugin-js', file: `js/plugins/${name}`, count });
  }
  return out;
}

/** Plugin parameter values that contain text without being equal to it. */
function pluginPartPlaces(plugins: unknown[] | null, text: string): GameTextPlace[] {
  if (!plugins) return [];
  const out: GameTextPlace[] = [];
  forEachPluginString(plugins, (value, p, plugin) => {
    const at = value.indexOf(text);
    if (at < 0 || value === text) return;
    out.push({ where: 'plugin-value-part', plugin, setting: String(segKey(p[2] ?? '')), ref: { type: 'value', file: 'js/plugins.js', path: p }, snippet: snippet(value, at, text.length) });
  });
  return out;
}

/** Walks every string in a data file: counts whole matches and, when parts is set, records strings holding text. */
function scanStrings(v: unknown, text: string, file: string, at: PathSeg[], parts: GameTextPlace[] | null): number {
  if (typeof v === 'string') {
    if (v === text) return 1;
    if (!parts) return 0;
    const isNote = at[at.length - 1] === 'note';
    // A note holds many tag blocks (one profile per switch) that often share lines: each block holding the text is
    // its own place, or the chat would see only the first and miss the rest.
    const seen = new Set<string>();
    for (let i = v.indexOf(text); i >= 0; i = isNote ? v.indexOf(text, i + text.length) : -1) {
      const note = isNote ? noteTagAt(v, i, i + text.length) : undefined;
      const key = note ? `${note.tag}\u0000${note.index}` : '';
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push({ where: 'data-part', file, path: [...at], snippet: snippet(v, i, text.length), ...(note ? { note } : {}) });
    }
    return 0;
  }
  if (v === null || typeof v !== 'object') return 0;
  // One shared path stack: copying the path at every node is slow on large map files.
  let n = 0;
  const step = (k: string | number, x: unknown) => {
    at.push(k);
    n += scanStrings(x, text, file, at, parts);
    at.pop();
  };
  if (Array.isArray(v)) v.forEach((x, i) => step(i, x));
  else for (const [k, x] of Object.entries(v)) step(k, x);
  return n;
}

async function dataPlaces(root: string, text: string, parts: GameTextPlace[] | null): Promise<GameTextPlace[]> {
  const dir = path.join(root, 'data');
  if (!existsSync(dir)) return [];
  const out: GameTextPlace[] = [];
  for (const name of (await readdir(dir)).filter((n) => n.toLowerCase().endsWith('.json')).sort()) {
    let json: unknown;
    try {
      json = await readJsonFile(path.join(dir, name));
    } catch {
      continue;
    }
    const count = scanStrings(json, text, `data/${name}`, [], parts);
    if (count > 0) out.push({ where: 'data', file: `data/${name}`, count });
  }
  return out;
}

/**
 * Every place in the original copy at root where a whole string equals text (plugin settings first, then plugin
 * files, then data), followed by plugin setting values and data strings that contain it, when text is long enough.
 */
export async function findGameText(root: string, text: string): Promise<GameTextPlace[]> {
  if (text === '') return [];
  const plugins = await readPlugins(root);
  const parts: GameTextPlace[] | null = [...text].length >= FIND_PART_MIN_LENGTH ? [] : null;
  const exact = [...(await pluginPlaces(plugins, text)), ...(await jsPlaces(root, text)), ...(await dataPlaces(root, text, parts))];
  return [...exact, ...(parts ? [...pluginPartPlaces(plugins, text), ...parts] : [])];
}
