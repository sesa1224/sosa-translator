import { hasJapanese } from '../text/japanese.js';
import type { PathSeg, TextUnit } from '../types.js';
import type { DecisionGroup, Decisions, KeepRule, ParamMeta, PluginMeta } from './types.js';

/**
 * Where a span of display text must end: ASCII syntax characters, two or more spaces,
 * control codes (also with doubled backslashes, as inside script strings), %n, and stray backslashes.
 */
const BREAK = /["'`=:,;()[\]{}<>+|]| {2,}|\\+(?:[A-Za-z]+(?:\[[^\]\r\n]*\])?|[{}.|!><^$])|\\+|%\d+/g;

/** Spans of text holding at least one Japanese character, trimmed to their first and last non-ASCII character. */
export function japaneseSpans(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const segment = (start: number, end: number) => {
    let s = start;
    let e = end;
    while (s < e && text.charCodeAt(s) <= 0x7f) s++;
    while (e > s && text.charCodeAt(e - 1) <= 0x7f) e--;
    if (s < e && hasJapanese(text.slice(s, e))) out.push({ start: s, end: e });
  };
  let last = 0;
  for (const m of text.matchAll(BREAK)) {
    segment(last, m.index);
    last = m.index + m[0].length;
  }
  segment(last, text.length);
  return out;
}

/** The value's shape: Japanese spans become '◆' and digit runs '#'. */
export function shapeOf(text: string): string {
  let out = '';
  let last = 0;
  for (const s of japaneseSpans(text)) {
    out += text.slice(last, s.start).replace(/\d+/g, '#') + '◆';
    last = s.end;
  }
  return out + text.slice(last).replace(/\d+/g, '#');
}

/**
 * Pieces of source that stay as they are, in order. n+1 pieces mean n translated parts between them.
 * null when nothing would be left to translate.
 */
export function keepPieces(source: string, keep: KeepRule): string[] | null {
  if (keep.mode === 'whole') return ['', ''];
  if (keep.mode === 'args') {
    const tokens = [...source.matchAll(/\S+/g)].map((m) => ({ start: m.index, end: m.index + m[0].length }));
    const from = Math.max(0, keep.from);
    const last = tokens.length - Math.max(0, keep.dropLast) - 1;
    if (last < from) return null;
    return [source.slice(0, tokens[from].start), source.slice(tokens[last].end)];
  }
  const spans = japaneseSpans(source);
  if (spans.length === 0) return null;
  const pieces: string[] = [];
  let last = 0;
  for (const s of spans) {
    pieces.push(source.slice(last, s.start));
    last = s.end;
  }
  pieces.push(source.slice(last));
  return pieces;
}

// ---- keys -------------------------------------------------------------------------------

/** MV plugin command (356): 'mv:<first piece>'. */
export function mvCommandKey(command: string): string {
  return `mv:${command.trim().split(/\s+/)[0] ?? ''}`;
}

/** MZ plugin command (357) argument: 'mz:<plugin>:<command>:<argument>'. */
export function mzArgKey(plugin: string, command: string, arg: string): string {
  return `mz:${plugin}:${command}:${arg}`;
}

/** Plugin parameter: 'param:<plugin>:<path>', array indices written as [*]. path starts below 'parameters'. */
export function paramKey(plugin: string, path: PathSeg[]): string {
  let s = '';
  for (const seg of path) {
    const k = typeof seg === 'object' ? seg.key : seg;
    if (typeof k === 'number') s += '[*]';
    else s += s === '' ? k : `.${k}`;
  }
  return `param:${plugin}:${s}`;
}

/** Script (355/655) or comment (108/408): 'shape:<shape>'. */
export function shapeKey(source: string): string {
  return `shape:${shapeOf(source)}`;
}

/** Note tag: 'note:<file kind>:<tag>'. */
export function noteKey(fileKind: string, tag: string): string {
  return `note:${fileKind}:${tag}`;
}

/** Strings of a plugin's JS file: 'js:<file name>'. */
export function jsKey(fileName: string): string {
  return `js:${fileName}`;
}

/** Splits key 'kind:a:b:…' into at most n parts after the kind (the last part keeps any ':'). */
function parts(key: string, n: number): string[] {
  const body = key.slice(key.indexOf(':') + 1);
  const out: string[] = [];
  let rest = body;
  for (let i = 0; i < n - 1; i++) {
    const at = rest.indexOf(':');
    if (at < 0) break;
    out.push(rest.slice(0, at));
    rest = rest.slice(at + 1);
  }
  out.push(rest);
  return out;
}

/** Readable name of a decision key. */
export function keyLabel(key: string): string {
  const kind = key.slice(0, key.indexOf(':'));
  switch (kind) {
    case 'mz': return parts(key, 3).join(' · ');
    case 'param': case 'note': return parts(key, 2).join(' · ');
    case 'mv': case 'shape': case 'js': case 'unit': return parts(key, 1)[0];
    default: return key;
  }
}

/** Parses 'list[*].label' into ['list', '*', 'label']. */
function pathNames(p: string): string[] {
  return p.split(/\.|(?=\[)/).map((x) => (x === '[*]' ? '*' : x)).filter((x) => x !== '');
}

/** What the plugin's header says about the key's value, when it says something. */
export function metaFor(key: string, meta: Record<string, PluginMeta>): ParamMeta | undefined {
  const kind = key.slice(0, key.indexOf(':'));
  if (kind === 'mz') {
    const [plugin, command, arg] = parts(key, 3);
    return meta[plugin]?.commands[command]?.args[arg];
  }
  if (kind !== 'param') return undefined;
  const [plugin, path] = parts(key, 2);
  const m = meta[plugin];
  if (!m) return undefined;
  const names = pathNames(path);
  let cur: ParamMeta | undefined = m.params[names[0]];
  for (const name of names.slice(1)) {
    if (!cur) return undefined;
    if (name === '*') continue;
    const struct = /^struct<([^>]+)>/.exec(cur.type ?? '');
    cur = struct ? m.structs?.[struct[1]]?.[name] : undefined;
  }
  return cur;
}

/** Groups needs-decision units by decision key, largest first. fileNames: game file names without extension. */
export function groupDecisions(units: TextUnit[], d: Decisions, hints: { fileNames: Set<string>; meta: Record<string, PluginMeta> }): DecisionGroup[] {
  const groups = new Map<string, DecisionGroup>();
  for (const u of units) {
    if (!u.needsDecision || !u.decisionKey) continue;
    let g = groups.get(u.decisionKey);
    if (!g) {
      g = { key: u.decisionKey, label: keyLabel(u.decisionKey), kind: u.kind, count: 0, samples: [], hints: { fileNames: 0 }, decision: d[u.decisionKey] ?? null };
      const m = metaFor(u.decisionKey, hints.meta);
      if (m?.type !== undefined) g.hints.metaType = m.type;
      if (m?.text !== undefined) g.hints.metaText = m.text;
      if (m?.desc !== undefined) g.hints.metaDesc = m.desc;
      groups.set(u.decisionKey, g);
    }
    g.count += Math.max(1, u.refs.length);
    if (g.samples.length < 5 && !g.samples.includes(u.source)) {
      g.samples.push(u.source);
      if (hints.fileNames.has(u.source)) g.hints.fileNames++;
    }
  }
  return [...groups.values()].sort((a, b) => b.count - a.count);
}
