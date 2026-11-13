import type { Engine } from '../types.js';

/** Size of the game's message window (pixels). Kept free of node imports so the renderer can use it. */
export interface WindowMetrics {
  engine: Engine;
  boxWidth: number;      // 대사창 바깥 폭
  padding: number;       // 창 안쪽 여백(한쪽)
  textPadding: number;   // 글 왼쪽 여백
  fontSize: number;
  lineHeight: number;
  maxLines: number;
  faceIndent: number;    // 얼굴 그림이 있을 때 글이 밀리는 폭
  iconWidth: number;     // \I[n] 이 차지하는 폭
  sizeStep: number;      // \{ \} 한 번에 바뀌는 글자 크기
}
export interface PreviewSettings { fontPath: string | null; fontName: string | null; overrides: Partial<WindowMetrics> }
/** A piece of a laid-out line: text in one color and size, or an icon (\I[n]). */
export type Run =
  | { type: 'text'; text: string; color: number; size: number }
  | { type: 'icon'; index: number; size: number };
export interface LaidLine { runs: Run[]; width: number; overflow: number }   // overflow = 넘친 픽셀(0 이상)
export interface Layout { lines: LaidLine[]; maxWidth: number; available: number; lineOverflow: number; missingGlyphs: number }  // lineOverflow = 넘친 줄 수(maxLines 초과)
/** Width of text at a font size, and how many of its characters the font has no glyph for. */
export type Measure = (text: string, fontSize: number) => { width: number; missing: number };
/** Values the preview puts in for \N, \V, \G and \P (translated actor names where there are any). */
export interface PreviewContext { actorNames: Record<number, string>; variables: Record<number, string>; currencyUnit: string; partyNames: Record<number, string> }
