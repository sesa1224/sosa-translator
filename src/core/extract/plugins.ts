import { hasJapanese } from '../text/japanese.js';
import type { PathSeg } from '../types.js';
import type { RawUnit } from './events.js';

export interface PluginsFile { prefix: string; plugins: unknown[]; suffix: string }

/** Splits js/plugins.js into the text before the first '[', the plugin array, and the text after the last ']'. */
export function parsePluginsFile(text: string): PluginsFile {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error('plugins.js 를 읽을 수 없습니다');
  let plugins: unknown;
  try {
    plugins = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error('plugins.js 를 읽을 수 없습니다');
  }
  if (!Array.isArray(plugins)) throw new Error('plugins.js 를 읽을 수 없습니다');
  return { prefix: text.slice(0, start), plugins, suffix: text.slice(end + 1) };
}

export function serializePluginsFile(p: PluginsFile): string {
  return p.prefix + JSON.stringify(p.plugins) + p.suffix;
}

/** If s is a JSON-encoded object, array or string, returns the decoded value; otherwise undefined. */
function parseNested(s: string): unknown {
  const c = s.trimStart()[0];
  if (c !== '[' && c !== '{' && c !== '"') return undefined;
  try {
    const v = JSON.parse(s);
    if (typeof v === 'string' || (v !== null && typeof v === 'object')) return v;
  } catch {
    // not nested JSON
  }
  return undefined;
}

function segKey(seg: PathSeg): string | number {
  return typeof seg === 'object' ? seg.key : seg;
}

function child(node: unknown, key: string | number): unknown {
  if (node === null || typeof node !== 'object') return undefined;
  return (node as Record<string | number, unknown>)[key];
}

/** Reads the value at path, decoding segments marked json:true. */
export function getAtPath(root: unknown, path: PathSeg[]): unknown {
  let cur = root;
  for (const seg of path) {
    cur = child(cur, segKey(seg));
    if (typeof seg === 'object' && seg.json) {
      if (typeof cur !== 'string') return undefined;
      cur = JSON.parse(cur);
    }
  }
  return cur;
}

/** Writes value at path; segments marked json:true are decoded, changed, and re-encoded with JSON.stringify. */
export function setAtPath(root: unknown, path: PathSeg[], value: unknown): void {
  if (path.length === 0) throw new Error('빈 경로에는 쓸 수 없습니다');
  if (root === null || typeof root !== 'object') throw new Error('경로를 찾을 수 없습니다');
  const node = root as Record<string | number, unknown>;
  const [seg, ...rest] = path;
  const key = segKey(seg);
  const isJson = typeof seg === 'object' && seg.json;
  if (rest.length === 0) {
    node[key] = isJson ? JSON.stringify(value) : value;
    return;
  }
  if (isJson) {
    const raw = node[key];
    if (typeof raw !== 'string') throw new Error('경로를 찾을 수 없습니다');
    const inner = JSON.parse(raw);
    setAtPath(inner, rest, value);
    node[key] = JSON.stringify(inner);
  } else {
    setAtPath(node[key], rest, value);
  }
}

/** Extracts every Japanese string from plugin parameters, descending into nested JSON strings. */
export function extractFromPlugins(plugins: unknown[]): RawUnit[] {
  const out: RawUnit[] = [];
  const visit = (v: unknown, path: PathSeg[]) => {
    if (typeof v === 'string') {
      const nested = parseNested(v);
      if (nested !== undefined) {
        // Re-mark the last segment as a JSON container and descend.
        const last = path[path.length - 1];
        const jsonPath: PathSeg[] = [...path.slice(0, -1), { key: segKey(last), json: true }];
        if (typeof nested === 'string') {
          if (hasJapanese(nested)) out.push({ kind: 'plugin-param', source: nested, needsDecision: true, ref: { type: 'value', file: 'js/plugins.js', path: jsonPath } });
        } else {
          visitContainer(nested as object, jsonPath);
        }
        return;
      }
      if (hasJapanese(v)) out.push({ kind: 'plugin-param', source: v, needsDecision: true, ref: { type: 'value', file: 'js/plugins.js', path } });
      return;
    }
    if (v !== null && typeof v === 'object') visitContainer(v, path);
  };
  const visitContainer = (v: object, path: PathSeg[]) => {
    if (Array.isArray(v)) v.forEach((x, i) => visit(x, [...path, i]));
    else for (const [k, x] of Object.entries(v)) visit(x, [...path, k]);
  };

  plugins.forEach((p, i) => {
    if (p === null || typeof p !== 'object') return;
    const params = (p as Record<string, unknown>).parameters;
    if (params !== null && typeof params === 'object') visitContainer(params, [i, 'parameters']);
  });
  return out;
}
