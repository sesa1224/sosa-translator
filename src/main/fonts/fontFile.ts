import { readFile } from 'node:fs/promises';
import * as otNs from 'opentype.js';
import type { Font, NameTable } from 'opentype.js';
import type { Measure } from '../../core/preview/types.js';
import type { FontInfo } from '../../shared/api.js';

export type { FontInfo };

// opentype.js is a UMD bundle under Node (everything on the default export) and an ES module under Vite.
const ot: typeof otNs = (otNs as { parse?: unknown }).parse ? otNs : (otNs as unknown as { default: typeof otNs }).default;

/** Characters a font must have to count as a Hangul font: 가, 힣, 뷁. */
const HANGUL_PROBES = ['가', '힣', '뷁'];

async function parseFile(file: string): Promise<Font> {
  const buf = await readFile(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  return ot.parse(ab, { lowMemory: true });
}

function tables(font: Font): NameTable[] {
  const n = font.names;
  return [n.windows, n.unicode, n.macintosh, n as unknown as NameTable].filter((t): t is NameTable => !!t && typeof t === 'object');
}

/** First non-blank value of one of the keys, in one of the languages (lang 'ko' also matches 'ko-KR'). */
function nameOf(font: Font, keys: string[], lang: string | null): string | null {
  for (const key of keys) {
    for (const t of tables(font)) {
      const rec = t[key];
      if (!rec || typeof rec !== 'object') continue;
      for (const [l, v] of Object.entries(rec)) {
        if (typeof v !== 'string' || v.trim() === '') continue;
        if (lang === null || l === lang || l.startsWith(`${lang}-`)) return v.trim();
      }
    }
  }
  return null;
}

/** Name, style and Hangul coverage of a .ttf/.otf file; null when it cannot be read. */
export async function readFontInfo(file: string): Promise<FontInfo | null> {
  try {
    const font = await parseFile(file);
    const family = nameOf(font, ['preferredFamily', 'fontFamily'], 'en') ?? nameOf(font, ['preferredFamily', 'fontFamily'], null);
    if (!family) return null;
    const displayName = nameOf(font, ['preferredFamily', 'fontFamily'], 'ko') ?? family;
    const style = nameOf(font, ['preferredSubfamily', 'fontSubfamily'], 'en') ?? nameOf(font, ['preferredSubfamily', 'fontSubfamily'], null) ?? 'Regular';
    return { path: file, family, displayName, style, hasHangul: HANGUL_PROBES.every((c) => font.hasChar(c)), source: 'system' };
  } catch {
    return null;
  }
}

/** Whether a character the font lacks still counts as "missing" (spaces and control characters do not). */
function counts(ch: string): boolean {
  return ch.trim() !== '';
}

/** A parsed font that measures text the way the game draws it: one character at a time, no kerning. */
export class LoadedFont {
  /** Advance per character in ems; null = the font has no glyph for it. */
  private readonly advance = new Map<string, number | null>();

  private constructor(readonly path: string, private readonly font: Font) {}

  static async load(file: string): Promise<LoadedFont> {
    return new LoadedFont(file, await parseFile(file));
  }

  has(char: string): boolean {
    return this.em(char) !== null;
  }

  private em(ch: string): number | null {
    let a = this.advance.get(ch);
    if (a === undefined) {
      a = null;
      if (this.font.hasChar(ch)) {
        const g = this.font.charToGlyph(ch);
        if (g.index > 0 && typeof g.advanceWidth === 'number') a = g.advanceWidth / this.font.unitsPerEm;
      }
      this.advance.set(ch, a);
    }
    return a;
  }

  readonly measure: Measure = (text, fontSize) => {
    let width = 0;
    let missing = 0;
    for (const ch of text) {
      const code = ch.codePointAt(0)!;
      if (code < 0x20 || code === 0x7f) continue;   // control characters are not drawn
      const a = this.em(ch);
      if (a === null) {
        width += fontSize;
        if (counts(ch)) missing++;
      } else width += a * fontSize;
    }
    return { width, missing };
  };
}
