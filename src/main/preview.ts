import { existsSync } from 'node:fs';
import path from 'node:path';
import type { PxCheck } from '../core/check/format.js';
import { getAtPath } from '../core/extract/plugins.js';
import { buildContext, layoutMessage } from '../core/preview/layout.js';
import { DEFAULT_METRICS, detectMetrics, effectiveMetrics, loadPreviewSettings, savePreviewSettings } from '../core/preview/metrics.js';
import type { Layout, PreviewContext, PreviewSettings, WindowMetrics } from '../core/preview/types.js';
import { openProject, originalDir } from '../core/project/project.js';
import type { TextUnit } from '../core/types.js';
import { readJsonFile } from '../core/util/json.js';
import { LoadedFont, readFontInfo } from './fonts/fontFile.js';
import type { ProjectService } from './projectService.js';

/** Value shown for a \V[n] the preview knows nothing about (also used by the width check). */
export const SAMPLE_VARIABLE = '123';

/**
 * Whether each unit is shown with a face picture: one of its line runs follows a 101 command whose
 * face name is not empty. Read once from the original data.
 */
export async function faceMap(projectDir: string, units: TextUnit[]): Promise<Record<string, boolean>> {
  const dir = originalDir(projectDir, await openProject(projectDir));
  const files = new Map<string, unknown>();
  const load = async (file: string): Promise<unknown> => {
    if (!files.has(file)) {
      try {
        files.set(file, await readJsonFile(path.join(dir, file)));
      } catch {
        files.set(file, null);
      }
    }
    return files.get(file);
  };
  const out: Record<string, boolean> = {};
  for (const u of units) {
    let face = false;
    for (const ref of u.refs) {
      if (ref.type !== 'lines' || ref.code !== 401) continue;
      const list = getAtPath(await load(ref.file), ref.listPath);
      if (!Array.isArray(list)) continue;
      const head = list[ref.start - 1] as { code?: unknown; parameters?: unknown[] } | undefined;
      if (head?.code === 101 && Array.isArray(head.parameters) && typeof head.parameters[0] === 'string' && head.parameters[0] !== '') {
        face = true;
        break;
      }
    }
    out[u.id] = face;
  }
  return out;
}

const VARIABLE = /\\V\[(\d+)\]/gi;

/**
 * Preview settings, window size and the chosen font of an open project. Gives layouts to the screen and
 * the pixel-width check to the ProjectService.
 */
export class PreviewService {
  /** A font was chosen but its file cannot be found or read. */
  fontMissing = false;
  private s: PreviewSettings = { fontPath: null, fontName: null, overrides: {} };
  private detected: WindowMetrics;
  private ctx: PreviewContext = { actorNames: {}, variables: {}, currencyUnit: '', partyNames: {} };
  private faces: Record<string, boolean> = {};
  private font: LoadedFont | null = null;
  private readonly loaded = new Map<string, LoadedFont | null>();
  private readonly onChanged = (e: { ids: string[] }) => {
    // A translated actor name or currency unit changes what \N and \G show.
    if (e.ids.some((id) => { const k = this.svc.unit(id)?.kind; return k === 'db' || k === 'system'; })) void this.refreshContext();
  };

  constructor(private readonly svc: ProjectService) {
    this.detected = { ...DEFAULT_METRICS[svc.meta.engine] };
  }

  async init(): Promise<void> {
    const dir = this.svc.projectDir;
    this.s = await loadPreviewSettings(dir);
    this.detected = await detectMetrics(dir).catch(() => ({ ...DEFAULT_METRICS[this.svc.meta.engine] }));
    await this.refreshContext();
    this.faces = await faceMap(dir, this.svc.units()).catch(() => ({}));
    await this.applyFont(false);
    this.svc.off('changed', this.onChanged);
    this.svc.on('changed', this.onChanged);
  }

  /** Stops following the project (the project's checker is left as it is). */
  dispose(): void {
    this.svc.off('changed', this.onChanged);
  }

  settings(): PreviewSettings {
    return { ...this.s, overrides: { ...this.s.overrides } };
  }

  /** Window size in use: detected values with the user's overrides. */
  metrics(): WindowMetrics {
    return effectiveMetrics(this.detected, this.s.overrides);
  }

  detectedMetrics(): WindowMetrics {
    return { ...this.detected };
  }

  context(): PreviewContext {
    return structuredClone(this.ctx);
  }

  /** Chooses the game font (null = none) and saves it in preview.json. */
  async setFont(fontPath: string | null): Promise<void> {
    const info = fontPath ? await readFontInfo(fontPath) : null;
    this.s = { ...this.s, fontPath, fontName: info?.displayName ?? (fontPath ? path.basename(fontPath) : null) };
    await savePreviewSettings(this.svc.projectDir, this.s);
    if (fontPath) this.loaded.delete(fontPath);   // the file may have changed since it was last read
    await this.applyFont(true);
  }

  /** Replaces the user's window size overrides ({} = back to the detected values). */
  async setOverrides(o: Partial<WindowMetrics>): Promise<void> {
    const overrides: Partial<WindowMetrics> = {};
    for (const [k, v] of Object.entries(o ?? {})) if (k !== 'engine' && typeof v === 'number' && Number.isFinite(v) && v > 0) (overrides as Record<string, number>)[k] = v;
    this.s = { ...this.s, overrides };
    await savePreviewSettings(this.svc.projectDir, this.s);
    if (this.font) this.svc.setPxChecker(this.checker(this.font));
  }

  /** Layout of the unit's text (given text, else its translation, else the source); null without a usable font. */
  layoutFor(id: string, text?: string): Layout | null {
    const unit = this.svc.unit(id);
    if (!this.font || !unit) return null;
    const t = text ?? this.svc.entry(id).target ?? unit.source;
    return this.layoutWith(this.font, t, this.faces[id] ?? false);
  }

  /**
   * Counts translated dialogue with a line over the window. fontPath tries another font without saving it
   * (undefined or null = the chosen one).
   */
  async countOverflow(fontPath?: string | null): Promise<{ overflowing: number; checked: number; missingGlyphs: number }> {
    const font = fontPath ? await this.fontAt(fontPath) : this.font;
    if (!font) return { overflowing: 0, checked: 0, missingGlyphs: 0 };
    let overflowing = 0;
    let checked = 0;
    let missingGlyphs = 0;
    for (const u of this.svc.units()) {
      if (u.kind !== 'dialogue') continue;
      const target = this.svc.entry(u.id).target;
      if (target === null) continue;
      checked++;
      const l = this.layoutWith(font, target, this.faces[u.id] ?? false);
      if (l.lines.some((line) => line.overflow > 0)) overflowing++;
      missingGlyphs += l.missingGlyphs;
    }
    return { overflowing, checked, missingGlyphs };
  }

  private layoutWith(font: LoadedFont, text: string, withFace: boolean): Layout {
    return layoutMessage(text, this.metrics(), font.measure, this.sampleContext(text), { withFace });
  }

  /** The context with SAMPLE_VARIABLE for every \V[n] in text that has no value. */
  private sampleContext(text: string): PreviewContext {
    let variables: Record<number, string> | null = null;
    for (const m of text.matchAll(VARIABLE)) {
      const n = Number(m[1]);
      if (this.ctx.variables[n] === undefined) {
        variables ??= { ...this.ctx.variables };
        variables[n] = SAMPLE_VARIABLE;
      }
    }
    return variables ? { ...this.ctx, variables } : this.ctx;
  }

  private checker(font: LoadedFont): (unit: TextUnit) => PxCheck | undefined {
    return (unit) => (unit.kind === 'dialogue'
      ? { layout: (text, withFace) => this.layoutWith(font, text, withFace), withFace: this.faces[unit.id] ?? false }
      : undefined);
  }

  private async fontAt(file: string): Promise<LoadedFont | null> {
    if (this.loaded.has(file)) return this.loaded.get(file)!;
    let f: LoadedFont | null = null;
    if (existsSync(file)) f = await LoadedFont.load(file).catch(() => null);
    if (this.loaded.size >= 16) this.loaded.delete(this.loaded.keys().next().value!);
    this.loaded.set(file, f);
    return f;
  }

  private async applyFont(announce: boolean): Promise<void> {
    const p = this.s.fontPath;
    const before = this.font;
    this.font = p ? await this.fontAt(p) : null;
    this.fontMissing = p !== null && this.font === null;
    if (this.font) this.svc.setPxChecker(this.checker(this.font), announce);
    else this.svc.setPxChecker(null, announce && before !== null);
  }

  private async refreshContext(): Promise<void> {
    const targets = new Map<string, string>();
    for (const u of this.svc.units()) {
      if (u.kind !== 'db' && u.kind !== 'system') continue;
      const t = this.svc.entry(u.id).target;
      if (t !== null && !targets.has(u.source)) targets.set(u.source, t);
    }
    try {
      this.ctx = await buildContext(this.svc.projectDir, (s) => targets.get(s) ?? null);
    } catch {
      // keep the previous names
    }
  }
}
