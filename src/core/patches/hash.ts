import { createHash } from 'node:crypto';

/** JSON with object keys sorted, so the text depends on content only. */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : canonicalJson(x))).join(',')}]`;
  const o = v as Record<string, unknown>;
  const keys = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(',')}}`;
}

/**
 * sha1 of a command list's content. Whitespace and key order do not change it, so a game re-saved by the editor
 * is not taken for an updated one.
 */
export function listHash(list: unknown): string {
  return createHash('sha1').update(canonicalJson(list)).digest('hex');
}

/** Whether two JSON values have the same content (key order ignored). */
export function sameContent(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}
