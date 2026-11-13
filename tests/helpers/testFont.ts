import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as otNs from 'opentype.js';

// opentype.js ships a UMD bundle (default export under Node) and an ESM build (named exports).
const ot: any = (otNs as any).Font ? otNs : (otNs as any).default;

export const TEST_UNITS_PER_EM = 1000;

/**
 * Writes a tiny .ttf with only the given glyphs (character -> advance width in font units, 1000 per em)
 * and returns its path. nameKo becomes the Korean family name in the name table.
 */
export async function makeTestFont(
  dir: string,
  o: { name: string; nameKo?: string; style?: string; glyphs: Record<string, number>; file?: string },
): Promise<string> {
  const glyphs = [new ot.Glyph({ name: '.notdef', unicode: 0, advanceWidth: 500, path: new ot.Path() })];
  let i = 0;
  for (const [ch, advanceWidth] of Object.entries(o.glyphs)) {
    const p = new ot.Path();
    if (ch.trim() !== '') {
      p.moveTo(50, 0);
      p.lineTo(50, 700);
      p.lineTo(Math.max(60, advanceWidth - 50), 700);
      p.lineTo(Math.max(60, advanceWidth - 50), 0);
      p.close();
    }
    glyphs.push(new ot.Glyph({ name: `g${i++}`, unicode: ch.codePointAt(0)!, advanceWidth, path: p }));
  }
  const font = new ot.Font({
    familyName: o.name, styleName: o.style ?? 'Regular', unitsPerEm: TEST_UNITS_PER_EM, ascender: 800, descender: -200, glyphs,
  });
  if (o.nameKo) {
    font.names.windows = font.names.windows ?? {};
    font.names.windows.fontFamily = { ...(font.names.windows.fontFamily ?? { en: o.name }), ko: o.nameKo };
  }
  const file = path.join(dir, o.file ?? `${o.name}.ttf`);
  await writeFile(file, Buffer.from(font.toArrayBuffer()));
  return file;
}
