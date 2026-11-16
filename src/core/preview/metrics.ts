import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parsePluginsFile } from '../extract/plugins.js';
import { openProject, originalDir } from '../project/project.js';
import type { Engine } from '../types.js';
import { readJsonFile, writeJsonFile } from '../util/json.js';
import type { PreviewSettings, TextWindow, WindowMetrics, WindowOverride, WindowOverrides } from './types.js';
import { availableWidth, HELP_LINES, helpWidthFor, TEXT_WINDOWS } from './windows.js';

export { availableWidth };

export const PREVIEW_FILE = 'preview.json';

export const DEFAULT_METRICS: Record<Engine, WindowMetrics> = {
  MV: { engine: 'MV', boxWidth: 816, padding: 18, textPadding: 6, fontSize: 28, lineHeight: 36, maxLines: 4, faceIndent: 168, iconWidth: 36, sizeStep: 12, helpWidth: 774, helpMaxLines: HELP_LINES, helpFontSize: 28 },
  MZ: { engine: 'MZ', boxWidth: 808, padding: 12, textPadding: 8, fontSize: 26, lineHeight: 36, maxLines: 4, faceIndent: 164, iconWidth: 36, sizeStep: 12, helpWidth: 768, helpMaxLines: HELP_LINES, helpFontSize: 26 },
};

/** A positive number from a JSON value or a plugin parameter string; null otherwise. */
function positive(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

interface PluginEntry { name?: unknown; status?: unknown; parameters?: unknown }

/**
 * A plugin parameter that the plugin evals: a plain number, or one of the few expressions plugins ship as
 * defaults (`Graphics.boxWidth`, `Window_Base._faceWidth + 24`). Anything else is not guessed at: null.
 */
function evalParam(v: unknown, names: Record<string, number>): number | null {
  if (typeof v !== 'string') return positive(v);
  const m = /^\s*(?:([A-Za-z_$][\w$.]*)\s*(?:([+-])\s*(\d+(?:\.\d+)?))?|(\d+(?:\.\d+)?))\s*$/.exec(v);
  if (!m) return null;
  if (m[4] !== undefined) return positive(m[4]);
  const base = names[m[1]];
  if (base === undefined) return null;
  const n = m[3] === undefined ? 0 : Number(m[3]) * (m[2] === '-' ? -1 : 1);
  return positive(base + n);
}

/**
 * MV window sizes from the plugins that change them, read in load order so a later plugin wins as it does in the
 * game (Community_Basic and YEP_CoreEngine both set SceneManager._boxWidth when they load). What each value
 * means was read from rpg_windows.js, YEP_CoreEngine 1.24 and YEP_MessageCore 1.18:
 *   - screen width: Graphics.boxWidth, the help window's width.
 *   - YEP_CoreEngine: Window Padding (standardPadding), Text Padding, Font Size (standardFontSize, used by the
 *     help window), Face Width (Window_Base._faceWidth), Line Height, Icon Width (an icon takes width + 4).
 *   - YEP_MessageCore: Default Width (the message window's width, evaled), Default Rows, Font Size (the message
 *     window only), Face Indent (evaled; without the plugin the engine indents by 168 whatever the face width).
 */
function mvFromPlugins(plugins: unknown[], m: WindowMetrics): void {
  let screen = m.boxWidth;
  let faceWidth = 144;
  let baseFont: number | null = null;
  let msg: Record<string, unknown> | null = null;
  for (const p of plugins as PluginEntry[]) {
    if (!p || p.status !== true || !p.parameters || typeof p.parameters !== 'object') continue;
    const params = p.parameters as Record<string, unknown>;
    if (p.name === 'Community_Basic') {
      screen = positive(params.screenWidth) ?? screen;
    } else if (p.name === 'YEP_CoreEngine') {
      screen = positive(params['Screen Width']) ?? screen;
      baseFont = positive(params['Font Size']) ?? baseFont;
      m.padding = positive(params['Window Padding']) ?? m.padding;
      m.textPadding = positive(params['Text Padding']) ?? m.textPadding;
      m.lineHeight = positive(params['Line Height']) ?? m.lineHeight;
      faceWidth = positive(params['Face Width']) ?? faceWidth;
      const icon = positive(params['Icon Width']);
      if (icon !== null) m.iconWidth = icon + 4;
    } else if (p.name === 'YEP_MessageCore') {
      msg = params;
    }
  }
  m.boxWidth = screen;
  if (baseFont !== null) m.fontSize = baseFont;
  m.helpFontSize = m.fontSize;
  if (msg) {
    m.boxWidth = evalParam(msg['Default Width'], { 'Graphics.boxWidth': screen }) ?? screen;
    const rows = evalParam(msg['Default Rows'], {});
    if (rows !== null) m.maxLines = Math.floor(rows);
    const font = positive(msg['Font Size']);
    if (font !== null) m.fontSize = font;
    m.faceIndent = evalParam(msg['Face Indent'], { 'Window_Base._faceWidth': faceWidth }) ?? faceWidth + 24;
  }
  m.helpWidth = helpWidthFor(m, screen);
  m.helpMaxLines = HELP_LINES;
}

/** Window sizes for the project's game: defaults, adjusted by System.json (MZ) or known plugins (MV). Never throws. */
export async function detectMetrics(projectDir: string): Promise<WindowMetrics> {
  const meta = await openProject(projectDir);
  const m: WindowMetrics = { ...DEFAULT_METRICS[meta.engine] };
  const dir = originalDir(projectDir, meta);
  if (meta.engine === 'MZ') {
    try {
      const sys = (await readJsonFile(path.join(dir, 'data', 'System.json'))) as { advanced?: { uiAreaWidth?: unknown; fontSize?: unknown } };
      const w = positive(sys.advanced?.uiAreaWidth);
      if (w !== null && w - 8 > 0) m.boxWidth = w - 8;
      const f = positive(sys.advanced?.fontSize);
      if (f !== null) m.fontSize = f;
      m.helpWidth = helpWidthFor(m, m.boxWidth);
      m.helpFontSize = m.fontSize;
    } catch {
      // keep the defaults
    }
  } else {
    const file = path.join(dir, 'js', 'plugins.js');
    if (existsSync(file)) {
      try {
        const { plugins } = parsePluginsFile(await readFile(file, 'utf8'));
        const next = { ...m };
        mvFromPlugins(plugins, next);
        Object.assign(m, next);
      } catch {
        // keep the defaults
      }
    }
  }
  return m;
}

const NUMERIC_KEYS: (keyof WindowMetrics)[] = ['boxWidth', 'padding', 'textPadding', 'fontSize', 'lineHeight', 'maxLines', 'faceIndent', 'iconWidth', 'sizeStep'];

/** detected with the user's overrides on top (only numeric keys that hold positive numbers). */
export function effectiveMetrics(detected: WindowMetrics, overrides: Partial<WindowMetrics>): WindowMetrics {
  const out: WindowMetrics = { ...detected };
  for (const k of NUMERIC_KEYS) {
    const v = overrides[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) (out as unknown as Record<string, number>)[k] = v;
  }
  return out;
}

export function defaultPreviewSettings(): PreviewSettings {
  return { fontPath: null, fontName: null, overrides: {} };
}

/** Per-window values that hold positive numbers; windows without any are left out. */
export function cleanWindowOverrides(raw: unknown): WindowOverrides {
  const out: WindowOverrides = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const w of TEXT_WINDOWS) {
    const v = (raw as Record<TextWindow, unknown>)[w];
    if (!v || typeof v !== 'object') continue;
    const o: WindowOverride = {};
    const width = positive((v as WindowOverride).width);
    const lines = positive((v as WindowOverride).maxLines);
    if (width !== null) o.width = Math.round(width);
    if (lines !== null) o.maxLines = Math.floor(lines);
    if (Object.keys(o).length > 0) out[w] = o;
  }
  return out;
}

/** <projectDir>/preview.json, or the defaults when it is missing or broken. A file without per-window values reads as before. */
export async function loadPreviewSettings(projectDir: string): Promise<PreviewSettings> {
  const file = path.join(projectDir, PREVIEW_FILE);
  if (!existsSync(file)) return defaultPreviewSettings();
  try {
    const v = (await readJsonFile(file)) as Partial<PreviewSettings>;
    const s: PreviewSettings = {
      fontPath: typeof v.fontPath === 'string' ? v.fontPath : null,
      fontName: typeof v.fontName === 'string' ? v.fontName : null,
      overrides: v.overrides && typeof v.overrides === 'object' ? { ...v.overrides } : {},
    };
    const windows = cleanWindowOverrides(v.windows);
    if (Object.keys(windows).length > 0) s.windows = windows;
    return s;
  } catch {
    return defaultPreviewSettings();
  }
}

export async function savePreviewSettings(projectDir: string, s: PreviewSettings): Promise<void> {
  const windows = cleanWindowOverrides(s.windows);
  await writeJsonFile(path.join(projectDir, PREVIEW_FILE), {
    fontPath: s.fontPath, fontName: s.fontName, overrides: s.overrides, ...(Object.keys(windows).length > 0 ? { windows } : {}),
  });
}
