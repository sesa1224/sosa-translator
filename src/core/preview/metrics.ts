import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { parsePluginsFile } from '../extract/plugins.js';
import { openProject, originalDir } from '../project/project.js';
import type { Engine } from '../types.js';
import { readJsonFile, writeJsonFile } from '../util/json.js';
import type { PreviewSettings, WindowMetrics } from './types.js';

export const PREVIEW_FILE = 'preview.json';

export const DEFAULT_METRICS: Record<Engine, WindowMetrics> = {
  MV: { engine: 'MV', boxWidth: 816, padding: 18, textPadding: 6, fontSize: 28, lineHeight: 36, maxLines: 4, faceIndent: 168, iconWidth: 36, sizeStep: 12 },
  MZ: { engine: 'MZ', boxWidth: 808, padding: 12, textPadding: 8, fontSize: 26, lineHeight: 36, maxLines: 4, faceIndent: 164, iconWidth: 36, sizeStep: 12 },
};

/** A positive number from a JSON value or a plugin parameter string; null otherwise. */
function positive(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

interface PluginEntry { name?: unknown; status?: unknown; parameters?: unknown }

function enabledPlugin(plugins: unknown[], name: string): Record<string, unknown> | null {
  for (const p of plugins as PluginEntry[]) {
    if (p && p.name === name && p.status === true && p.parameters && typeof p.parameters === 'object') return p.parameters as Record<string, unknown>;
  }
  return null;
}

/** Message window size for the project's game: defaults, adjusted by System.json (MZ) or known plugins (MV). Never throws. */
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
    } catch {
      // keep the defaults
    }
  } else {
    const file = path.join(dir, 'js', 'plugins.js');
    if (existsSync(file)) {
      try {
        const { plugins } = parsePluginsFile(await readFile(file, 'utf8'));
        const yep = enabledPlugin(plugins, 'YEP_CoreEngine');
        if (yep) {
          const w = positive(yep['Screen Width']);
          if (w !== null) m.boxWidth = w;
          const f = positive(yep['Font Size']);
          if (f !== null) m.fontSize = f;
        }
        const basic = enabledPlugin(plugins, 'Community_Basic');
        if (basic) {
          const w = positive(basic.screenWidth);
          if (w !== null) m.boxWidth = w;
        }
      } catch {
        // keep the defaults
      }
    }
  }
  return m;
}

/** Width a line of text may take inside the window. */
export function availableWidth(m: WindowMetrics, withFace: boolean): number {
  return m.boxWidth - m.padding * 2 - m.textPadding * 2 - (withFace ? m.faceIndent : 0);
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

/** <projectDir>/preview.json, or the defaults when it is missing or broken. */
export async function loadPreviewSettings(projectDir: string): Promise<PreviewSettings> {
  const file = path.join(projectDir, PREVIEW_FILE);
  if (!existsSync(file)) return defaultPreviewSettings();
  try {
    const v = (await readJsonFile(file)) as Partial<PreviewSettings>;
    return {
      fontPath: typeof v.fontPath === 'string' ? v.fontPath : null,
      fontName: typeof v.fontName === 'string' ? v.fontName : null,
      overrides: v.overrides && typeof v.overrides === 'object' ? { ...v.overrides } : {},
    };
  } catch {
    return defaultPreviewSettings();
  }
}

export async function savePreviewSettings(projectDir: string, s: PreviewSettings): Promise<void> {
  await writeJsonFile(path.join(projectDir, PREVIEW_FILE), { fontPath: s.fontPath, fontName: s.fontName, overrides: s.overrides });
}
