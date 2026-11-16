// Which game window draws a sentence, and how wide and tall that window's text area is. Kept free of node
// imports so the renderer can use it too. The formulas follow the engines' own code:
//   MV Window_Message: contents width = width - standardPadding * 2, text starts at newLineX (0, or the face
//     indent), so the text padding is not taken off. Window_Help: drawTextEx at textPadding, clipped at the
//     contents width. (rpg_windows.js)
//   MZ: no game was at hand to read the engine code, so the message window keeps the rule the app had
//     (padding and item padding on both sides) and the help window uses the same rule.
import type { TextUnit, UnitRef } from '../types.js';
import type { TextWindow, WindowLimit, WindowMetrics, WindowOverrides } from './types.js';

export const TEXT_WINDOWS: TextWindow[] = ['message', 'help'];
/** Names the warnings and screens use. */
export const TEXT_WINDOW_LABEL: Record<TextWindow, string> = { message: '대사창', help: '설명창' };
/** Lines of the help window when nothing says otherwise (Window_Help: numLines || 2). */
export const HELP_LINES = 2;

/** Width a line of text may take inside the message window. */
export function availableWidth(m: WindowMetrics, withFace: boolean): number {
  const face = withFace ? m.faceIndent : 0;
  if (m.engine === 'MV') return m.boxWidth - m.padding * 2 - face;
  return m.boxWidth - m.padding * 2 - m.textPadding * 2 - face;
}

/** Where the message window's text starts, measured from the window's left edge. */
export function textLeft(m: WindowMetrics, withFace: boolean): number {
  const face = withFace ? m.faceIndent : 0;
  return m.engine === 'MV' ? m.padding + face : m.padding + m.textPadding + face;
}

/** Help window line width for a screen as wide as the message window (used when helpWidth is unknown). */
export function helpWidthFor(m: WindowMetrics, screenWidth: number): number {
  return m.engine === 'MV' ? screenWidth - m.padding * 2 - m.textPadding : screenWidth - m.padding * 2 - m.textPadding * 2;
}

const positive = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0;

/** Each window's limits as detected (metrics with the old overrides already applied). */
export function detectedLimits(m: WindowMetrics): Record<TextWindow, WindowLimit> {
  return {
    message: { width: availableWidth(m, false), maxLines: m.maxLines, fontSize: m.fontSize },
    help: {
      width: positive(m.helpWidth) ? m.helpWidth : helpWidthFor(m, m.boxWidth),
      maxLines: positive(m.helpMaxLines) ? m.helpMaxLines : HELP_LINES,
      fontSize: positive(m.helpFontSize) ? m.helpFontSize : m.fontSize,
    },
  };
}

/** Each window's limits in use: detected, with the user's per-window width and line count on top. */
export function windowLimits(m: WindowMetrics, o: WindowOverrides | undefined): Record<TextWindow, WindowLimit> {
  const out = detectedLimits(m);
  for (const w of TEXT_WINDOWS) {
    const x = o?.[w];
    if (positive(x?.width)) out[w].width = x.width;
    if (positive(x?.maxLines)) out[w].maxLines = Math.floor(x.maxLines);
  }
  return out;
}

const HELP_FILES = new Set(['data/Items.json', 'data/Weapons.json', 'data/Armors.json', 'data/Skills.json']);

/** The window one place of a sentence is drawn in, or null for places the program does not measure. */
export function refWindow(kind: TextUnit['kind'], ref: UnitRef): TextWindow | null {
  if (kind === 'dialogue' && ref.type === 'lines' && ref.code === 401) return 'message';
  if (kind === 'db' && ref.type === 'value' && HELP_FILES.has(ref.file) && ref.path.length === 2 && ref.path[1] === 'description') return 'help';
  return null;
}

/**
 * The windows a sentence is drawn in. fixable: every place is in one and the same window, so line breaks can be
 * moved for it; a sentence also used somewhere else (a name, a second kind of window) is only measured.
 */
export function unitWindows(unit: TextUnit): { windows: TextWindow[]; fixable: boolean } {
  const seen = new Set<TextWindow>();
  let plain = false;
  for (const r of unit.refs) {
    const w = refWindow(unit.kind, r);
    if (w) seen.add(w);
    else plain = true;
  }
  const windows = TEXT_WINDOWS.filter((w) => seen.has(w));
  return { windows, fixable: windows.length === 1 && !plain };
}
