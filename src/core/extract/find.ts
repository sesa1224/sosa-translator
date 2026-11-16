// Finds where a piece of text sits in an original copy, for the chat: text seen on screen that is not a
// translation unit is looked up here instead of guessed at. Only whole strings equal to the text count.
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PathSeg, UnitRef } from '../types.js';
import { readJsonFile } from '../util/json.js';
import { headerBlockRanges } from './pluginMeta.js';
import { extractFromPlugins, parsePluginsFile } from './plugins.js';

/**
 * One place the text was found. Plugin parameter places carry the ref an extracted unit would have, so the caller
 * can tell whether it is a unit already; file places only say how many times.
 */
export type GameTextPlace =
  | { where: 'plugin-value'; plugin: string; setting: string; ref: UnitRef }
  | { where: 'plugin-key'; plugin: string; setting: string; ref: UnitRef }
  | { where: 'plugin-js'; file: string; count: number }
  | { where: 'data'; file: string; count: number };

const segKey = (s: PathSeg): string | number => (typeof s === 'object' ? s.key : s);

/** Places in plugins.js: parameter values equal to text, and key names equal to text inside parameter values. */
async function pluginPlaces(root: string, text: string): Promise<GameTextPlace[]> {
  const file = path.join(root, 'js', 'plugins.js');
  if (!existsSync(file)) return [];
  let plugins: unknown[];
  try {
    plugins = parsePluginsFile(await readFile(file, 'utf8')).plugins;
  } catch {
    return [];
  }
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

function countStrings(v: unknown, text: string): number {
  if (typeof v === 'string') return v === text ? 1 : 0;
  if (v === null || typeof v !== 'object') return 0;
  let n = 0;
  for (const x of Object.values(v)) n += countStrings(x, text);
  return n;
}

async function dataPlaces(root: string, text: string): Promise<GameTextPlace[]> {
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
    const count = countStrings(json, text);
    if (count > 0) out.push({ where: 'data', file: `data/${name}`, count });
  }
  return out;
}

/** Every place in the original copy at root where a whole string equals text: plugin settings first, then plugin files, then data. */
export async function findGameText(root: string, text: string): Promise<GameTextPlace[]> {
  if (text === '') return [];
  return [...(await pluginPlaces(root, text)), ...(await jsPlaces(root, text)), ...(await dataPlaces(root, text))];
}
