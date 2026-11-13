/**
 * Control code tokens:
 *  - backslash + letters + optional [...]   e.g. \C[2], \N[1], \FS[20]
 *  - backslash + one symbol                  { } . | ! > < ^ $ \
 *  - % + digits                              e.g. %1
 */
const TOKEN = /\\[A-Za-z]+(?:\[[^\]\r\n]*\])?|\\[{}.|!><^$\\]|%\d+/g;

/** Control codes in order of appearance, letter part upper-cased (\c[2] == \C[2]). */
export function controlCodes(s: string): string[] {
  const out: string[] = [];
  for (const m of s.matchAll(TOKEN)) {
    out.push(m[0].replace(/^\\[A-Za-z]+/, (head) => head.toUpperCase()));
  }
  return out;
}

/** s with every control code token removed. */
export function stripControlCodes(s: string): string {
  return s.replace(TOKEN, '');
}
