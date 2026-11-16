import { existsSync } from 'node:fs';
import path from 'node:path';
import type { PxCheck } from '../core/check/format.js';
import { getAtPath } from '../core/extract/plugins.js';
import { buildContext, layoutMessage } from '../core/preview/layout.js';
import { DEFAULT_METRICS, detectMetrics, effectiveMetrics, loadPreviewSettings, savePreviewSettings } from '../core/preview/metrics.js';
import type {
  Layout, PreviewContext, PreviewSettings, TextWindow, TextWindowInfo, WindowLimit, WindowMetrics, WindowOverride, WindowOverrides,
} from '../core/preview/types.js';
import { detectedLimits, TEXT_WINDOWS, unitWindows, windowLimits } from '../core/preview/windows.js';
import type { WindowSetting } from '../shared/api.js';
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
/** The character "한글 약 n자" is counted in. */
export const HANGUL_SAMPLE = '가';

/** The preview service of each open project (the chat tools find it from the project). */
const services = new WeakMap<ProjectService, PreviewService>();

export function attachPreviewService(svc: ProjectService, p: PreviewService | null): void {
  if (p) services.set(svc, p);
  else services.delete(svc);
}

export function previewServiceOf(svc: ProjectService): PreviewService | undefined {
  return services.get(svc);
}

/** Where a unit is measured: the narrowest of the windows it is drawn in, and whether only there. */
interface UnitPlace { window: TextWindow; withFace: boolean; maxLines: number; fixable: boolean }

/**
 * Preview settings, window sizes and the chosen font of an open project. Gives layouts to the screen and
 * the pixel-width check to the ProjectService.
 */
export class PreviewService {
  /** A font was chosen but its file cannot be found or read. */
  fontMissing = false;
  private s: PreviewSettings = { fontPath: null, fontName: null, overrides: {} };
  private detected: WindowMetrics;
  private m: WindowMetrics;
  private lim: Record<TextWindow, WindowLimit>;
  private ctx: PreviewContext = { actorNames: {}, variables: {}, currencyUnit: '', partyNames: {} };
  private faces: Record<string, boolean> = {};
  private font: LoadedFont | null = null;
  private readonly loaded = new Map<string, LoadedFont | null>();
  private readonly listeners = new Set<() => void>();
  private readonly onChanged = (e: { ids: string[] }) => {
    // A translated actor name or currency unit changes what \N and \G show.
    if (e.ids.some((id) => { const k = this.svc.unit(id)?.kind; return k === 'db' || k === 'system'; })) void this.refreshContext();
  };

  constructor(private readonly svc: ProjectService) {
    this.detected = { ...DEFAULT_METRICS[svc.meta.engine] };
    this.m = this.detected;
    this.lim = windowLimits(this.m, undefined);
  }

  async init(): Promise<void> {
    const dir = this.svc.projectDir;
    this.s = await loadPreviewSettings(dir);
    this.detected = await detectMetrics(dir).catch(() => ({ ...DEFAULT_METRICS[this.svc.meta.engine] }));
    this.refreshLimits();
    await this.refreshContext();
    this.faces = await faceMap(dir, this.svc.units()).catch(() => ({}));
    await this.applyFont(false);
    this.svc.off('changed', this.onChanged);
    this.svc.on('changed', this.onChanged);
    attachPreviewService(this.svc, this);
  }

  /** Stops following the project (the project's checker is left as it is). */
  dispose(): void {
    this.svc.off('changed', this.onChanged);
    if (previewServiceOf(this.svc) === this) attachPreviewService(this.svc, null);
    this.listeners.clear();
  }

  /** Calls fn whenever the settings change (from the screen or from the chat). Returns the way to stop. */
  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  settings(): PreviewSettings {
    const out: PreviewSettings = { ...this.s, overrides: { ...this.s.overrides } };
    if (this.s.windows) out.windows = structuredClone(this.s.windows);
    return out;
  }

  /** Window size in use: detected values with the user's overrides. */
  metrics(): WindowMetrics {
    return { ...this.m };
  }

  detectedMetrics(): WindowMetrics {
    return { ...this.detected };
  }

  /** Each window's line width and line count in use. */
  limits(): Record<TextWindow, WindowLimit> {
    return structuredClone(this.lim);
  }

  /** Each window as the settings screen shows it: in use, detected, the user's values and the width of '가'. */
  windows(): Record<TextWindow, TextWindowInfo> {
    const detected = detectedLimits(this.m);
    const info = (w: TextWindow): TextWindowInfo => ({
      limit: { ...this.lim[w] }, detected: detected[w], override: { ...this.s.windows?.[w] },
      hangulWidth: this.font ? this.font.measure(HANGUL_SAMPLE, this.lim[w].fontSize).width : null, faceIndent: this.m.faceIndent,
    });
    return { message: info('message'), help: info('help') };
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
    this.notify();
  }

  /** Replaces the user's window size overrides ({} = back to the detected values). */
  async setOverrides(o: Partial<WindowMetrics>): Promise<void> {
    const overrides: Partial<WindowMetrics> = {};
    for (const [k, v] of Object.entries(o ?? {})) if (k !== 'engine' && typeof v === 'number' && Number.isFinite(v) && v > 0) (overrides as Record<string, number>)[k] = v;
    this.s = { ...this.s, overrides };
    await this.saveAndRecheck();
  }

  /** Sets (a number) or clears (null) the user's line width and line count of one window; a missing key stays. */
  async setWindow(window: TextWindow, change: WindowSetting): Promise<void> {
    if (!TEXT_WINDOWS.includes(window)) throw new Error(`없는 창 종류입니다: ${String(window)}`);
    const all: WindowOverrides = structuredClone(this.s.windows ?? {});
    const next: WindowOverride = { ...all[window] };
    for (const k of ['width', 'maxLines'] as const) {
      const v = change[k];
      if (v === null) delete next[k];
      else if (v !== undefined) {
        if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) throw new Error(k === 'width' ? '한 줄 너비는 0보다 큰 숫자여야 합니다' : '줄 수는 0보다 큰 숫자여야 합니다');
        next[k] = k === 'width' ? Math.round(v) : Math.floor(v);
      }
    }
    if (Object.keys(next).length > 0) all[window] = next;
    else delete all[window];
    this.s = { ...this.s, windows: all };
    await this.saveAndRecheck();
  }

  /** Width of one line of text in a window's font and size, codes applied (null without a font). */
  measureLine(text: string, window: TextWindow): number | null {
    if (!this.font) return null;
    const lim = this.lim[window];
    return layoutMessage(text, { ...this.m, fontSize: lim.fontSize }, this.font.measure, this.sampleContext(text), { withFace: false, width: lim.width }).maxWidth;
  }

  /** Layout of the unit's text (given text, else its translation, else the source); null without a usable font. */
  layoutFor(id: string, text?: string): Layout | null {
    const unit = this.svc.unit(id);
    if (!this.font || !unit) return null;
    const t = text ?? this.svc.entry(id).target ?? unit.source;
    const place = this.placeOf(unit) ?? { window: 'message' as const, withFace: this.faces[id] ?? false };
    return { ...this.layoutIn(this.font, t, place.window, place.withFace), window: place.window, withFace: place.withFace, maxLines: this.lim[place.window].maxLines };
  }

  /**
   * Counts translations drawn in a game window that do not fit it. fontPath tries another font without saving it
   * (undefined or null = the chosen one).
   */
  async countOverflow(fontPath?: string | null): Promise<{ overflowing: number; checked: number; missingGlyphs: number }> {
    const font = fontPath ? await this.fontAt(fontPath) : this.font;
    if (!font) return { overflowing: 0, checked: 0, missingGlyphs: 0 };
    let overflowing = 0;
    let checked = 0;
    let missingGlyphs = 0;
    for (const u of this.svc.units()) {
      const place = this.placeOf(u);
      if (!place) continue;
      const target = this.svc.entry(u.id).target;
      if (target === null) continue;
      checked++;
      const l = this.layoutIn(font, target, place.window, place.withFace);
      if (l.lineOverflow > 0 || l.lines.some((line) => line.overflow > 0)) overflowing++;
      missingGlyphs += l.missingGlyphs;
    }
    return { overflowing, checked, missingGlyphs };
  }

  private refreshLimits(): void {
    this.m = effectiveMetrics(this.detected, this.s.overrides);
    this.lim = windowLimits(this.m, this.s.windows);
  }

  private async saveAndRecheck(): Promise<void> {
    this.refreshLimits();
    await savePreviewSettings(this.svc.projectDir, this.s);
    if (this.font) this.svc.setPxChecker(this.checker(this.font));
    this.notify();
  }

  private notify(): void {
    for (const fn of this.listeners) fn();
  }

  /** The window a unit is measured in (the narrowest of its places), or null when it is drawn in none. */
  private placeOf(unit: TextUnit): UnitPlace | null {
    const { windows, fixable } = unitWindows(unit);
    if (windows.length === 0) return null;
    const face = this.faces[unit.id] ?? false;
    let best: UnitPlace | null = null;
    let bestWidth = Infinity;
    for (const w of windows) {
      const withFace = w === 'message' && face;
      const width = this.lim[w].width - (withFace ? this.m.faceIndent : 0);
      if (width < bestWidth) {
        bestWidth = width;
        best = { window: w, withFace, maxLines: this.lim[w].maxLines, fixable };
      }
    }
    best!.maxLines = Math.min(...windows.map((w) => this.lim[w].maxLines));
    return best;
  }

  private layoutIn(font: LoadedFont, text: string, window: TextWindow, withFace: boolean): Layout {
    const lim = this.lim[window];
    const m = { ...this.m, fontSize: lim.fontSize, maxLines: lim.maxLines };
    return layoutMessage(text, m, font.measure, this.sampleContext(text), { withFace: window === 'message' && withFace, width: lim.width });
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
    return (unit) => {
      const place = this.placeOf(unit);
      if (!place) return undefined;
      return {
        layout: (text, withFace) => this.layoutIn(font, text, place.window, withFace), withFace: place.withFace,
        window: place.window, maxLines: place.maxLines, fixable: place.fixable,
      };
    };
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
