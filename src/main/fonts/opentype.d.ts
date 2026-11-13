// opentype.js 2.0 ships no type declarations. Only what this app uses is described here.
declare module 'opentype.js' {
  export type NameRecord = Record<string, string>;
  export type NameTable = Record<string, NameRecord | undefined>;
  export class Path {
    constructor();
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    close(): void;
  }
  export class Glyph {
    constructor(o: { name: string; unicode?: number; advanceWidth: number; path: Path });
    index: number;
    advanceWidth: number | undefined;
    unicode: number | undefined;
  }
  export class Font {
    constructor(o: { familyName: string; styleName: string; unitsPerEm: number; ascender: number; descender: number; glyphs: Glyph[] });
    unitsPerEm: number;
    names: { unicode?: NameTable; windows?: NameTable; macintosh?: NameTable } & Record<string, unknown>;
    hasChar(c: string): boolean;
    charToGlyph(c: string): Glyph;
    charToGlyphIndex(c: string): number;
    toArrayBuffer(): ArrayBuffer;
  }
  export function parse(buffer: ArrayBuffer, opt?: { lowMemory?: boolean }): Font;
}
