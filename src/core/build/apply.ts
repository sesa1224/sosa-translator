import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { getAtPath, parsePluginsFile, serializePluginsFile, setAtPath, type PluginsFile } from '../extract/plugins.js';
import { openProject, originalDir } from '../project/project.js';
import type { TranslationStore } from '../store/translations.js';
import type { TextUnit, UnitRef, Warning } from '../types.js';
import { confirmedDecisionFor, isTranslatable } from '../decisions/store.js';
import { checkSkeleton } from '../decisions/skeleton.js';
import type { Decisions } from '../decisions/types.js';
import { replaceNoteValue } from '../extract/notes.js';
import { readJsonFile } from '../util/json.js';

const PLUGINS_FILE = 'js/plugins.js';

interface Op { ref: UnitRef; target: string }
type ListRef = Extract<UnitRef, { type: 'lines' } | { type: 'choice' }>;
type NoteRef = Extract<UnitRef, { type: 'note' }>;
type JsRef = Extract<UnitRef, { type: 'js' }>;

interface Cmd { code: number; indent: number; parameters: unknown[] }

function isCmd(v: unknown): v is Cmd {
  return !!v && typeof v === 'object' && typeof (v as Cmd).code === 'number' && Array.isArray((v as Cmd).parameters);
}

/**
 * The target to write, or null. A needs-decision unit with a confirmed decision goes in only when the decision
 * says translate and the kept pieces are unchanged; without a confirmed decision only an approved one goes in.
 */
function shouldApply(unit: TextUnit, store: TranslationStore, decisions: Decisions): string | null {
  const e = store.get(unit.id);
  if (e.target === null || e.status === 'error' || e.status === 'declined') return null;
  if (!unit.needsDecision) return e.target;
  const dec = confirmedDecisionFor(unit, decisions);
  if (dec === null) return e.status === 'approved' ? e.target : null;
  if (!isTranslatable(unit, decisions)) return null;
  return checkSkeleton(unit.source, e.target, dec.keep).length === 0 ? e.target : null;
}

/** Writes text into a JS string literal with the given quote: unescaped quotes and line breaks get escaped, existing escapes stay. */
export function escapeForQuote(text: string, quote: '"' | "'" | '`'): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') {
      if (i + 1 >= text.length) out += '\\\\';
      else out += c + text[++i];
    } else if (c === quote) out += '\\' + c;
    else if (quote === '`' && c === '$' && text[i + 1] === '{') out += '\\$';
    else if (c === '\n' && quote !== '`') out += '\\n';
    else if (c === '\r' && quote !== '`') out += '\\r';
    else out += c;
  }
  return out;
}

function listAt(root: unknown, ref: ListRef): unknown[] {
  const list = getAtPath(root, ref.listPath);
  if (!Array.isArray(list)) throw new Error(`${ref.file}: 이벤트 목록을 찾을 수 없습니다`);
  return list;
}

function applyChoice(root: unknown, ref: Extract<UnitRef, { type: 'choice' }>, target: string): void {
  const list = listAt(root, ref);
  const cmd = list[ref.index];
  if (!isCmd(cmd) || cmd.code !== 102 || !Array.isArray(cmd.parameters[0])) {
    throw new Error(`${ref.file}: 선택지 위치가 맞지 않습니다 (${ref.index})`);
  }
  (cmd.parameters[0] as unknown[])[ref.choice] = target;
  // The matching branch label (402) must carry the same text.
  for (let j = ref.index + 1; j < list.length; j++) {
    const c = list[j];
    if (!isCmd(c) || c.indent !== cmd.indent) continue;
    if (c.code === 404) break;
    if (c.code === 402 && c.parameters[0] === ref.choice) {
      c.parameters[1] = target;
      break;
    }
  }
}

function applyLines(root: unknown, ref: Extract<UnitRef, { type: 'lines' }>, target: string): void {
  const list = listAt(root, ref);
  for (let k = ref.start; k < ref.start + ref.count; k++) {
    const c = list[k];
    if (!isCmd(c) || c.code !== ref.code) throw new Error(`${ref.file}: 대사 위치가 맞지 않습니다 (${ref.start})`);
  }
  const indent = (list[ref.start] as Cmd).indent;
  const cmds = target.split('\n').map((line) => ({ code: ref.code, indent, parameters: [line] }));
  list.splice(ref.start, ref.count, ...cmds);
}

/** Applies all ops to one parsed file. Values first, then list edits from the back so indices stay valid. */
function applyOps(root: unknown, ops: Op[]): void {
  for (const op of ops) {
    if (op.ref.type === 'value') setAtPath(root, op.ref.path, op.target);
    else if (op.ref.type === 'note') applyNote(root, op.ref, op.target);
  }
  const listOps = ops.filter((op): op is { ref: ListRef; target: string } => op.ref.type === 'lines' || op.ref.type === 'choice');
  const groups = new Map<string, { ref: ListRef; target: string }[]>();
  for (const op of listOps) {
    const key = JSON.stringify(op.ref.listPath);
    const g = groups.get(key) ?? [];
    g.push(op);
    groups.set(key, g);
  }
  const pos = (r: ListRef) => (r.type === 'lines' ? r.start : r.index);
  for (const g of groups.values()) {
    g.sort((a, b) => pos(b.ref) - pos(a.ref));
    for (const op of g) {
      if (op.ref.type === 'choice') applyChoice(root, op.ref, op.target);
      else applyLines(root, op.ref, op.target);
    }
  }
}

function applyNote(root: unknown, ref: NoteRef, target: string): void {
  const note = getAtPath(root, ref.path);
  if (typeof note !== 'string') throw new Error(`${ref.file}: 메모란을 찾을 수 없습니다`);
  setAtPath(root, ref.path, replaceNoteValue(note, ref.tag, ref.index, target));
}

/**
 * Replaces string literals of a plugin JS file, from the back. Returns null when a recorded place no longer
 * holds its source (the file changed after extraction): then nothing in the file is replaced.
 */
function applyJs(text: string, ops: { ref: JsRef; target: string; source: string }[]): string | null {
  if (ops.some((op) => text.slice(op.ref.start, op.ref.end) !== op.source)) return null;
  let out = text;
  for (const op of [...ops].sort((a, b) => b.ref.start - a.ref.start)) {
    out = out.slice(0, op.ref.start) + escapeForQuote(op.target, op.ref.quote) + out.slice(op.ref.end);
  }
  return out;
}

async function readPlugins(file: string): Promise<PluginsFile> {
  let text = await readFile(file, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return parsePluginsFile(text);
}

/**
 * Builds the translated text of every file that received at least one translation, with warnings for
 * plugin JS files left out. Key: file path relative to contentDir ('data/Map001.json', 'js/plugins.js',
 * 'js/plugins/X.js'). The original copy is never written.
 */
export async function applyTranslationsDetailed(
  projectDir: string,
  units: TextUnit[],
  store: TranslationStore,
  o: { decisions?: Decisions } = {},
): Promise<{ files: Map<string, string>; warnings: Warning[] }> {
  const meta = await openProject(projectDir);
  const root = originalDir(projectDir, meta);
  const decisions = o.decisions ?? {};

  const byFile = new Map<string, (Op & { source: string })[]>();
  for (const u of units) {
    const target = shouldApply(u, store, decisions);
    if (target === null) continue;
    for (const ref of u.refs) {
      const ops = byFile.get(ref.file) ?? [];
      ops.push({ ref, target, source: u.source });
      byFile.set(ref.file, ops);
    }
  }

  const out = new Map<string, string>();
  const warnings: Warning[] = [];
  for (const file of [...byFile.keys()].sort()) {
    const ops = byFile.get(file)!;
    const abs = path.join(root, ...file.split('/'));
    const jsOps = ops.filter((op): op is { ref: JsRef; target: string; source: string } => op.ref.type === 'js');
    if (jsOps.length > 0) {
      let text: string | null = null;
      try {
        text = applyJs(await readFile(abs, 'utf8'), jsOps);
      } catch {
        text = null;
      }
      if (text === null) warnings.push({ file, message: '추출 뒤에 파일이 바뀌어 적용하지 않았습니다' });
      else out.set(file, text);
    } else if (file === PLUGINS_FILE) {
      const p = await readPlugins(abs);
      applyOps(p.plugins, ops);
      out.set(file, serializePluginsFile(p));
    } else {
      let json: unknown;
      try {
        json = await readJsonFile(abs);
      } catch (e) {
        throw new Error(`${file}: 원본 파일을 읽을 수 없습니다 (${e instanceof Error ? e.message : String(e)})`);
      }
      applyOps(json, ops);
      out.set(file, JSON.stringify(json));
    }
  }
  return { files: out, warnings };
}

/**
 * Builds the translated text of every file that received at least one translation.
 * Key: file path relative to contentDir ('data/Map001.json', 'js/plugins.js'). The original copy is never written.
 */
export async function applyTranslations(
  projectDir: string,
  units: TextUnit[],
  store: TranslationStore,
  o: { decisions?: Decisions } = {},
): Promise<Map<string, string>> {
  return (await applyTranslationsDetailed(projectDir, units, store, o)).files;
}
