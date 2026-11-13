import { readFile } from 'node:fs/promises';
import path from 'node:path';
import * as otNs from 'opentype.js';
import subsetFont from 'subset-font';
import { appliedPatches } from '../core/patches/apply.js';
import { loadPatches } from '../core/patches/store.js';
import type { Patch } from '../core/patches/types.js';
import { openProject, originalDir } from '../core/project/project.js';
import type { Engine, PathSeg, TextUnit, TranslationEntry } from '../core/types.js';
import type { ProjectService } from './projectService.js';

// opentype.js is a UMD bundle under Node (everything on the default export) and an ES module under Vite.
const ot: typeof otNs = (otNs as { parse?: unknown }).parse ? otNs : (otNs as unknown as { default: typeof otNs }).default;

export const GAME_FONT_BASENAME = 'mvmz-game-font';

/**
 * Characters a game shows that a translation does not hold: ASCII, digits, punctuation and full-width symbols
 * the game's own windows, menus and numbers use.
 */
const BASE_CHARS = (() => {
  let s = '';
  for (let c = 0x20; c <= 0x7e; c++) s += String.fromCharCode(c);
  return s + '…―—─“”‘’「」『』【】（）〈〉《》！？～・♥❤♡★☆♪→←↑↓○●◎△▲▽▼□■※×÷＋－＝％＆＠＃' + '　';
})();

/** Strings anywhere inside a value (command parameters, json values). */
function strings(v: unknown, out: string[]): void {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === 'object') for (const x of Object.values(v)) strings(x, out);
}

/**
 * Every character the patched game may draw: all translations, the strings patches add, the base set and extra.
 * Control codes stay in as their letters (ASCII, already in the base set). No duplicates.
 */
export function usedCharacters(units: TextUnit[], entryOf: (id: string) => TranslationEntry, patches: Patch[], extra = ''): string {
  const parts: string[] = [BASE_CHARS];
  for (const u of units) {
    const t = entryOf(u.id)?.target;
    if (typeof t === 'string') parts.push(t);
  }
  for (const p of patches) {
    const b = p.body;
    if (b.kind === 'event') for (const op of b.ops) if (op.op !== 'delete') strings(op.commands, parts);
    if (b.kind === 'json') strings(b.value, parts);
  }
  parts.push(extra);
  const seen = new Set<string>();
  for (const s of parts) for (const ch of s) if (ch >= ' ') seen.add(ch);
  return [...seen].join('');
}

/** Characters of chars the font has no glyph for. */
function missingCount(font: Uint8Array, chars: string): number {
  try {
    const f = ot.parse(font.buffer.slice(font.byteOffset, font.byteOffset + font.byteLength) as ArrayBuffer, { lowMemory: true });
    let n = 0;
    for (const ch of new Set(chars)) if (f.charToGlyphIndex(ch) === 0) n++;
    return n;
  } catch {
    return 0;
  }
}

/** Points the GameFont @font-face of an MV gamefont.css at file; other blocks stay as they are. */
export function retargetGameFontCss(css: string | null, file: string): string {
  const fresh = `@font-face { font-family: GameFont; src: url("${file}"); }\n`;
  if (css === null) return fresh;
  let found = false;
  const out = css.replace(/@font-face\s*\{[^}]*\}/g, (block) => {
    if (!/font-family\s*:\s*["']?GameFont["']?\s*;?/i.test(block)) return block;
    found = true;
    return block.replace(/src\s*:[^;}]*/i, `src: url("${file}")`);
  });
  return found ? out : `${css}${css.endsWith('\n') || css === '' ? '' : '\n'}${fresh}`;
}

/**
 * The files that put a font into the patch. MZ: the font under fonts/ plus a System.json change for its main font;
 * MV: the font plus fonts/gamefont.css pointing GameFont at it. subset keeps only chars (same sfnt format).
 */
export async function fontPatchFiles(o: {
  engine: Engine; contentPrefix: string; projectDir: string; fontPath: string; subset: boolean; chars: string;
}): Promise<{ files: Map<string, string | Uint8Array>; jsonPatch?: { file: string; path: PathSeg[]; value: unknown }; missing: number; bytes: number }> {
  const original = new Uint8Array(await readFile(o.fontPath));
  const ext = path.extname(o.fontPath).toLowerCase() === '.otf' ? '.otf' : '.ttf';
  const name = `${GAME_FONT_BASENAME}${ext}`;
  const font = o.subset ? new Uint8Array(await subsetFont(Buffer.from(original), o.chars, { targetFormat: 'sfnt' })) : original;
  const files = new Map<string, string | Uint8Array>([[`${o.contentPrefix}fonts/${name}`, font]]);
  const missing = missingCount(original, o.chars);
  if (o.engine === 'MZ') {
    return { files, jsonPatch: { file: 'data/System.json', path: ['advanced', 'mainFontFilename'], value: name }, missing, bytes: font.length };
  }
  let css: string | null = null;
  try {
    const meta = await openProject(o.projectDir);
    css = await readFile(path.join(originalDir(o.projectDir, meta), 'fonts', 'gamefont.css'), 'utf8');
  } catch {
    css = null;
  }
  files.set(`${o.contentPrefix}fonts/gamefont.css`, retargetGameFontCss(css, name));
  return { files, missing, bytes: font.length };
}

/** Sets a value, making missing objects on the way (System.json of an old game may lack 'advanced'). */
function setDeep(root: Record<string, unknown>, p: PathSeg[], value: unknown): void {
  let cur = root;
  p.forEach((seg, i) => {
    const key = String(typeof seg === 'object' ? seg.key : seg);
    if (i === p.length - 1) cur[key] = value;
    else {
      if (!cur[key] || typeof cur[key] !== 'object') cur[key] = {};
      cur = cur[key] as Record<string, unknown>;
    }
  });
}

/** What the last build's font step reported (missing glyphs, size), for the screen. */
export const lastFontEmbed = new WeakMap<ProjectService, { missing: number; bytes: number }>();

/**
 * Adds the font of the project's font patch and the JS files of its plugin patches to every build.
 * Nothing is added while those patches are off or in conflict.
 */
const registered = new WeakSet<ProjectService>();

export function registerFontContributor(svc: ProjectService): void {
  if (registered.has(svc)) return;
  registered.add(svc);
  svc.buildContributors.push(async (ctx) => {
    const out = new Map<string, string | Uint8Array>();
    const patches = await appliedPatches(ctx.projectDir, await loadPatches(ctx.projectDir).catch(() => []));
    for (const p of patches) {
      if (p.body.kind === 'plugin') out.set(`${ctx.contentPrefix}js/plugins/${p.body.name}.js`, p.body.js);
    }
    const font = patches.find((p) => p.body.kind === 'font');
    if (!font || font.body.kind !== 'font') return out;
    const meta = await openProject(ctx.projectDir);
    const chars = usedCharacters(svc.units(), (id) => svc.entry(id), patches);
    const r = await fontPatchFiles({ engine: meta.engine, contentPrefix: ctx.contentPrefix, projectDir: ctx.projectDir, fontPath: font.body.fontPath, subset: font.body.subset, chars });
    lastFontEmbed.set(svc, { missing: r.missing, bytes: r.bytes });
    for (const [k, v] of r.files) out.set(k, v);
    if (r.jsonPatch) {
      const file = r.jsonPatch.file;
      let text = ctx.changed.get(file);
      if (text === undefined) text = await readFile(path.join(originalDir(ctx.projectDir, meta), ...file.split('/')), 'utf8');
      const json = JSON.parse(text.replace(/^﻿/, '')) as Record<string, unknown>;
      setDeep(json, r.jsonPatch.path, r.jsonPatch.value);
      out.set(`${ctx.contentPrefix}${file}`, JSON.stringify(json));
    }
    return out;
  });
}
