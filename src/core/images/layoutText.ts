// Pure layout for text drawn into pictures. Used by the render worker (browser) and by the main
// process (overflow notes), so it must not import Node modules.
import type { Rect, Region } from './types.js';

export interface RegionLayout {
  lines: { text: string; x: number; y: number; width: number }[];
  overflowX: boolean;
  overflowY: boolean;
  lineHeightPx: number;
}

/** Characters that must not start a line; they hang at the end of the line before. */
const CLOSING = new Set([...'.,!?…」』）)]、。！？，．”’》〉】']);

/** Breaks one paragraph by characters (Korean and Japanese have no spaces to break at). */
function breakChars(text: string, maxW: number, measure: (t: string) => number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const ch of text) {
    if (cur === '' || measure(cur + ch) <= maxW) cur += ch;
    else if (CLOSING.has(ch)) cur += ch;
    else {
      out.push(cur);
      cur = ch;
    }
  }
  if (cur !== '') out.push(cur);
  return out;
}

/** Breaks one paragraph at spaces; a word wider than the area alone is broken by characters. */
function breakWords(text: string, maxW: number, measure: (t: string) => number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const word of text.split(' ').filter((w) => w !== '')) {
    const joined = cur === '' ? word : `${cur} ${word}`;
    if (measure(joined) <= maxW) {
      cur = joined;
      continue;
    }
    if (cur !== '') out.push(cur);
    if (measure(word) <= maxW) cur = word;
    else {
      const parts = breakChars(word, maxW, measure);
      cur = parts.pop() ?? '';
      out.push(...parts);
    }
  }
  if (cur !== '') out.push(cur);
  return out;
}

/** Splits the region's text into lines that fit its width and places them in picture coordinates. */
export function layoutRegionText(region: Region, measure: (text: string) => number): RegionLayout {
  const { rect } = region;
  const lineHeightPx = region.size * region.lineHeight;
  const texts: string[] = [];
  if (region.text !== '') {
    for (const para of region.text.split('\n')) {
      const trimmed = para.replace(/\s+$/, '');
      if (measure(trimmed) <= rect.w) texts.push(trimmed);
      else if (trimmed.includes(' ')) texts.push(...breakWords(trimmed, rect.w, measure));
      else texts.push(...breakChars(trimmed, rect.w, measure));
    }
  }
  const blockH = texts.length * lineHeightPx;
  const top = region.valign === 'top' ? rect.y : region.valign === 'bottom' ? rect.y + rect.h - blockH : rect.y + (rect.h - blockH) / 2;
  const x = region.align === 'left' ? rect.x : region.align === 'right' ? rect.x + rect.w : rect.x + rect.w / 2;
  const lines = texts.map((text, i) => ({ text, x, y: top + lineHeightPx * (i + 0.5), width: measure(text) }));
  return {
    lines,
    // Wider than the area: a single character that does not fit, or a line with hanging punctuation.
    overflowX: lines.some((l) => l.width > rect.w),
    overflowY: blockH > rect.h,
    lineHeightPx,
  };
}

const hex2 = (n: number) => Math.round(n).toString(16).padStart(2, '0');

/**
 * Average colour ('#rrggbbaa') of the 1px band just outside the rect. Sides touching the picture edge
 * are left out; with no side left, the rect's own edge pixels are used.
 */
export function sampleBorderColor(rgba: Uint8ClampedArray, width: number, height: number, rect: Rect): string {
  const sum = [0, 0, 0, 0];
  let n = 0;
  const add = (x: number, y: number) => {
    const at = (y * width + x) * 4;
    for (let i = 0; i < 4; i++) sum[i] += rgba[at + i];
    n++;
  };
  const x0 = Math.max(0, rect.x), y0 = Math.max(0, rect.y);
  const x1 = Math.min(width, rect.x + rect.w), y1 = Math.min(height, rect.y + rect.h);
  if (y0 - 1 >= 0) for (let x = x0; x < x1; x++) add(x, y0 - 1);
  if (y1 < height) for (let x = x0; x < x1; x++) add(x, y1);
  if (x0 - 1 >= 0) for (let y = y0; y < y1; y++) add(x0 - 1, y);
  if (x1 < width) for (let y = y0; y < y1; y++) add(x1, y);
  if (n === 0) {
    for (let x = x0; x < x1; x++) {
      add(x, y0);
      if (y1 - 1 > y0) add(x, y1 - 1);
    }
    for (let y = y0 + 1; y < y1 - 1; y++) {
      add(x0, y);
      if (x1 - 1 > x0) add(x1 - 1, y);
    }
  }
  if (n === 0) return '#00000000';
  return '#' + sum.map((s) => hex2(s / n)).join('');
}
