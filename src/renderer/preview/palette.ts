/** The 32 text colors of the default RPG Maker window skin (\C[0] .. \C[31]). */
export const DEFAULT_PALETTE: string[] = [
  '#ffffff', '#20a0d6', '#ff784c', '#66cc40', '#99ccff', '#ccc0ff', '#ffffa0', '#808080',
  '#c0c0c0', '#2080cc', '#ff3810', '#00a010', '#3e9ade', '#a098ff', '#ffcc20', '#000000',
  '#84aaff', '#ffff40', '#ff2020', '#202040', '#e08040', '#f0c040', '#4080c0', '#40c0f0',
  '#80ff80', '#c08080', '#8080ff', '#ff80ff', '#00a040', '#00e060', '#a060e0', '#c080ff',
];

const hex = (n: number) => n.toString(16).padStart(2, '0');

/**
 * Reads the 32 text colors from a window skin PNG (the 12 px squares at the bottom right, like the game does).
 * Falls back to DEFAULT_PALETTE when the image cannot be read.
 */
export async function paletteFromSkin(png: Uint8Array): Promise<string[]> {
  try {
    const blob = new Blob([png as BlobPart], { type: 'image/png' });
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const g = canvas.getContext('2d');
    if (!g) return DEFAULT_PALETTE;
    g.drawImage(bitmap, 0, 0);
    const out: string[] = [];
    for (let n = 0; n < 32; n++) {
      const x = 96 + (n % 8) * 12 + 6;
      const y = 144 + Math.floor(n / 8) * 12 + 6;
      const [r, gr, b] = g.getImageData(x, y, 1, 1).data;
      out.push(`#${hex(r)}${hex(gr)}${hex(b)}`);
    }
    return out;
  } catch {
    return DEFAULT_PALETTE;
  }
}
