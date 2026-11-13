// Lays out a message the way the game's message window draws it, so the app can show the in-game preview and
// warn about lines that overflow the window. metrics.ts finds the window size for the game; the caller gives
// the font measure (src/main/preview.ts measures with opentype.js), so this module needs no font code.
import path from 'node:path';
import { openProject, originalDir } from '../project/project.js';
import { readJsonFile } from '../util/json.js';
import { availableWidth } from './metrics.js';
import type { LaidLine, Layout, Measure, PreviewContext, Run, WindowMetrics } from './types.js';

/** Font size limits of \{ and \} per engine. */
const SIZE_LIMITS = { MV: { min: 24, max: 96 }, MZ: { min: 12, max: 108 } } as const;

const TOKEN = /\\([A-Za-z]+)(?:\[([^\]\r\n]*)\])?|\\([{}.|!><^$\\])/g;

/**
 * Lays out a message the way the game draws it: control codes replaced or applied, line by line.
 * Text that came from a replacement (\V, \N, \P, \G) is not parsed again.
 */
export function layoutMessage(text: string, m: WindowMetrics, measure: Measure, ctx: PreviewContext, o: { withFace: boolean }): Layout {
  const limits = SIZE_LIMITS[m.engine];
  const available = availableWidth(m, o.withFace);
  let color = 0;
  let size = m.fontSize;
  let missingGlyphs = 0;
  const lines: LaidLine[] = [];

  for (const raw of text.split('\n')) {
    const runs: Run[] = [];
    const addText = (t: string) => {
      if (t === '') return;
      const last = runs.at(-1);
      if (last && last.type === 'text' && last.color === color && last.size === size) last.text += t;
      else runs.push({ type: 'text', text: t, color, size });
    };
    let at = 0;
    for (const mt of raw.matchAll(TOKEN)) {
      addText(raw.slice(at, mt.index));
      at = mt.index + mt[0].length;
      const sym = mt[3];
      if (sym !== undefined) {
        if (sym === '\\') addText('\\');
        else if (sym === '{') size = Math.min(limits.max, size + m.sizeStep);
        else if (sym === '}') size = Math.max(limits.min, size - m.sizeStep);
        continue;   // . | ! > < ^ $ take no room
      }
      const code = mt[1].toUpperCase();
      const arg = mt[2];
      const n = arg !== undefined && /^\s*\d+\s*$/.test(arg) ? Number(arg) : NaN;
      if (code === 'C' && Number.isFinite(n)) color = n;
      else if (code === 'V') addText(Number.isFinite(n) ? ctx.variables[n] ?? '0' : '0');
      else if (code === 'N') addText(Number.isFinite(n) ? ctx.actorNames[n] ?? '' : '');
      else if (code === 'P') addText(Number.isFinite(n) ? ctx.partyNames[n] ?? '' : '');
      else if (code === 'G' && arg === undefined) addText(ctx.currencyUnit);
      else if (code === 'I' && Number.isFinite(n)) runs.push({ type: 'icon', index: n, size });
      // anything else: zero width, not drawn
    }
    addText(raw.slice(at));

    let width = 0;
    for (const r of runs) {
      if (r.type === 'icon') width += m.iconWidth;
      else {
        const w = measure(r.text, r.size);
        width += w.width;
        missingGlyphs += w.missing;
      }
    }
    lines.push({ runs, width, overflow: Math.max(0, width - available) });
  }

  return {
    lines,
    maxWidth: lines.reduce((a, l) => Math.max(a, l.width), 0),
    available,
    lineOverflow: Math.max(0, lines.length - m.maxLines),
    missingGlyphs,
  };
}

/**
 * Names the preview puts in place of \N, \P and \G. translated(source) gives the translation of a
 * database or system text (null when there is none). variables is left empty for the caller.
 */
export async function buildContext(projectDir: string, translated: (source: string) => string | null): Promise<PreviewContext> {
  const meta = await openProject(projectDir);
  const data = path.join(originalDir(projectDir, meta), 'data');
  const pick = (s: string) => (s === '' ? s : translated(s) ?? s);
  const actorNames: Record<number, string> = {};
  try {
    const actors = (await readJsonFile(path.join(data, 'Actors.json'))) as unknown[];
    actors.forEach((a, i) => {
      const name = (a as { name?: unknown } | null)?.name;
      if (typeof name === 'string') actorNames[i] = pick(name);
    });
  } catch {
    // no actors
  }
  let currencyUnit = '';
  const partyNames: Record<number, string> = {};
  try {
    const sys = (await readJsonFile(path.join(data, 'System.json'))) as { currencyUnit?: unknown; partyMembers?: unknown };
    if (typeof sys.currencyUnit === 'string') currencyUnit = pick(sys.currencyUnit);
    if (Array.isArray(sys.partyMembers)) {
      sys.partyMembers.forEach((id, i) => {
        if (typeof id === 'number' && actorNames[id] !== undefined) partyNames[i + 1] = actorNames[id];
      });
    }
  } catch {
    // no system data
  }
  return { actorNames, variables: {}, currencyUnit, partyNames };
}
