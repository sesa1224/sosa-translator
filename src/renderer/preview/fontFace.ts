const registered = new Map<string, Promise<string>>();

/** Short stable hash of a path (FNV-1a), used to name its CSS font family. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** CSS family name the font at path is registered under. */
export function fontFamilyName(path: string): string {
  return `mvmz-font-${hash(path)}`;
}

/**
 * Loads the font file through window.api.fonts.bytes and registers it with document.fonts.
 * Returns the CSS family name. Each path is registered once; a failed load can be tried again.
 */
export function ensureFontFace(path: string): Promise<string> {
  let p = registered.get(path);
  if (!p) {
    p = (async () => {
      const bytes = await window.api.fonts.bytes(path);
      const family = fontFamilyName(path);
      const face = new FontFace(family, bytes as BufferSource);
      await face.load();
      document.fonts.add(face);
      return family;
    })();
    registered.set(path, p);
    p.catch(() => registered.delete(path));
  }
  return p;
}
