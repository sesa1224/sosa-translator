// Writes translations into copies of the game's data files, in memory; the original copy is only read.
// Each UnitRef says where a sentence sits. Event patches are applied first, with commands tagged by their
// original position so translations still find their lines (applyWithPatches). Needs-decision units go in
// only as their confirmed decision allows, and only while the kept pieces are intact (decisions/skeleton.ts).
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
import type { PathSeg } from '../types.js';
import type { EventCommand, Patch } from '../patches/types.js';
import { appliedPatches, eventListPaths } from '../patches/apply.js';
import { applyOps as applyListOps, indexOfOrigin, tagList, untagList, type TaggedCommand } from '../patches/listOps.js';
import { JOSA_PLUGIN_DESCRIPTION, JOSA_PLUGIN_JS, JOSA_PLUGIN_NAME } from '../patches/josa.js';
import { loadPatches } from '../patches/store.js';

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

/**
 * Renames key names (after values and patches, whose paths use the original names). All keys of one object are
 * renamed at once by their original names, keeping order and values; deeper objects go first so the paths to them
 * still hold. A new name that would clash with another key of the object leaves that key as it was, with a warning.
 */
function applyKeyOps(root: unknown, ops: Op[], warnings: Warning[]): void {
  const byObject = new Map<string, { path: PathSeg[]; file: string; names: Map<string, string> }>();
  for (const op of ops) {
    if (op.ref.type !== 'key') continue;
    const id = JSON.stringify(op.ref.path);
    const g = byObject.get(id) ?? { path: op.ref.path, file: op.ref.file, names: new Map<string, string>() };
    g.names.set(op.ref.key, op.target);
    byObject.set(id, g);
  }
  for (const g of [...byObject.values()].sort((a, b) => b.path.length - a.path.length)) {
    let obj: unknown;
    try {
      obj = getAtPath(root, g.path);
    } catch {
      obj = undefined;
    }
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
      warnings.push({ file: g.file, message: '열쇠 이름을 바꿀 객체를 찾을 수 없어 적용하지 않았습니다' });
      continue;
    }
    const keys = Object.keys(obj);
    const renames = new Map([...g.names].filter(([from, to]) => keys.includes(from) && from !== to));
    for (const from of g.names.keys()) {
      if (!keys.includes(from)) warnings.push({ file: g.file, message: `열쇠 이름 "${from}" 을 찾을 수 없어 적용하지 않았습니다` });
    }
    // Drop renames until every final name is unique; a dropped rename keeps its old name, which may clash in turn.
    for (;;) {
      const finalOf = (k: string) => renames.get(k) ?? k;
      const seen = new Map<string, string[]>();
      for (const k of keys) seen.set(finalOf(k), [...(seen.get(finalOf(k)) ?? []), k]);
      const clashing = keys.filter((k) => renames.has(k) && seen.get(finalOf(k))!.length > 1);
      if (clashing.length === 0) break;
      for (const k of clashing) {
        warnings.push({ file: g.file, message: `열쇠 이름 "${k}" 의 번역 "${renames.get(k)}" 이 같은 객체의 다른 열쇠와 겹쳐 바꾸지 않았습니다` });
        renames.delete(k);
      }
    }
    if (renames.size === 0) continue;
    const src = obj as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const k of keys) next[renames.get(k) ?? k] = src[k];
    setAtPath(root, g.path, next);
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

/** Writes the values of json patches (after translations, so a patch wins over a translation of the same place). */
function applyJsonPatches(root: unknown, patches: Patch[]): void {
  for (const p of patches) if (p.body.kind === 'json') setAtPath(root, p.body.path, structuredClone(p.body.value));
}

const segOf = (s: PathSeg): string | number => (typeof s === 'object' ? s.key : s);

/**
 * Applies event patches and translations to one data file. Every command list is tagged with original positions
 * first, the patches edit the lists, and each translation finds its commands by tag, so commands a patch added or
 * removed do not move a translation to the wrong line. A translation whose commands a patch removed is skipped.
 */
function applyWithPatches(json: unknown, file: string, ops: Op[], patches: Patch[]): void {
  const lists = new Map<string, PathSeg[]>();
  for (const lp of eventListPaths(file, json)) {
    lists.set(JSON.stringify(lp), lp);
    setAtPath(json, lp, tagList(getAtPath(json, lp) as EventCommand[]));
  }
  for (const p of patches) {
    if (p.body.kind !== 'event') continue;
    const list = getAtPath(json, p.body.listPath);
    if (!Array.isArray(list)) continue;
    setAtPath(json, p.body.listPath, applyListOps(list as TaggedCommand[], p.body.ops));
  }
  const taggedAt = (lp: PathSeg[]): TaggedCommand[] | null => {
    if (!lists.has(JSON.stringify(lp))) return null;
    const l = getAtPath(json, lp);
    return Array.isArray(l) ? (l as TaggedCommand[]) : null;
  };

  const mapped: Op[] = [];
  for (const op of ops) {
    const ref = op.ref;
    if (ref.type === 'lines') {
      const list = taggedAt(ref.listPath);
      if (!list) { mapped.push(op); continue; }
      const start = indexOfOrigin(list, ref.start);
      // Every line of the run must still be there, in one piece.
      let whole = start >= 0;
      for (let k = 1; whole && k < ref.count; k++) whole = indexOfOrigin(list, ref.start + k) === start + k;
      if (whole) mapped.push({ ...op, ref: { ...ref, start } });
    } else if (ref.type === 'choice') {
      const list = taggedAt(ref.listPath);
      if (!list) { mapped.push(op); continue; }
      const index = indexOfOrigin(list, ref.index);
      if (index >= 0) mapped.push({ ...op, ref: { ...ref, index } });
    } else if (ref.type === 'value') {
      const p = ref.path;
      let at = -1;
      for (let i = 0; i + 1 < p.length; i++) {
        if (segOf(p[i]) === 'list' && typeof segOf(p[i + 1]) === 'number' && taggedAt(p.slice(0, i + 1))) { at = i + 1; break; }
      }
      if (at < 0) { mapped.push(op); continue; }
      const index = indexOfOrigin(taggedAt(p.slice(0, at))!, segOf(p[at]) as number);
      if (index >= 0) mapped.push({ ...op, ref: { ...ref, path: [...p.slice(0, at), index, ...p.slice(at + 1)] } });
    } else mapped.push(op);
  }
  applyOps(json, mapped);
  applyJsonPatches(json, patches);
  for (const lp of lists.values()) {
    const l = getAtPath(json, lp);
    if (Array.isArray(l)) setAtPath(json, lp, untagList(l as TaggedCommand[]));
  }
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
  o: { decisions?: Decisions; patches?: Patch[] } = {},
): Promise<{ files: Map<string, string>; warnings: Warning[] }> {
  const meta = await openProject(projectDir);
  const root = originalDir(projectDir, meta);
  const decisions = o.decisions ?? {};
  // buildPatch does not pass patches (patch.ts stays as it is), so they are read here when not given.
  const patches = await appliedPatches(projectDir, o.patches ?? (await loadPatches(projectDir).catch(() => [])));

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

  // Files only patches touch are built too.
  const patchFiles = new Map<string, Patch[]>();
  for (const p of patches) {
    const file = p.body.kind === 'event' || p.body.kind === 'json' ? p.body.file : p.body.kind === 'plugin' || p.body.kind === 'josa' ? PLUGINS_FILE : null;
    if (file === null) continue;
    patchFiles.set(file, [...(patchFiles.get(file) ?? []), p]);
    if (!byFile.has(file)) byFile.set(file, []);
  }

  const out = new Map<string, string>();
  const warnings: Warning[] = [];
  for (const file of [...byFile.keys()].sort()) {
    const ops = byFile.get(file)!;
    const filePatches = patchFiles.get(file) ?? [];
    if (filePatches.length > 0 && !ops.some((op) => op.ref.type === 'js')) {
      const abs = path.join(root, ...file.split('/'));
      if (file === PLUGINS_FILE) {
        const p = await readPlugins(abs);
        applyOps(p.plugins, ops);
        applyJsonPatches(p.plugins, filePatches);
        applyKeyOps(p.plugins, ops, warnings);
        for (const fp of filePatches) {
          if (fp.body.kind === 'plugin') p.plugins.push({ name: fp.body.name, status: true, description: fp.body.description, parameters: { ...fp.body.parameters } });
        }
        // Last of all, so it wraps the text functions after every other plugin has changed them.
        if (filePatches.some((fp) => fp.body.kind === 'josa')) {
          p.plugins.push({ name: JOSA_PLUGIN_NAME, status: true, description: JOSA_PLUGIN_DESCRIPTION, parameters: {} });
          out.set(`js/plugins/${JOSA_PLUGIN_NAME}.js`, JOSA_PLUGIN_JS);
        }
        out.set(file, serializePluginsFile(p));
      } else {
        let json: unknown;
        try {
          json = await readJsonFile(abs);
        } catch (e) {
          throw new Error(`${file}: 원본 파일을 읽을 수 없습니다 (${e instanceof Error ? e.message : String(e)})`);
        }
        applyWithPatches(json, file, ops, filePatches);
        applyKeyOps(json, ops, warnings);
        out.set(file, JSON.stringify(json));
      }
      continue;
    }
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
      applyKeyOps(p.plugins, ops, warnings);
      out.set(file, serializePluginsFile(p));
    } else {
      let json: unknown;
      try {
        json = await readJsonFile(abs);
      } catch (e) {
        throw new Error(`${file}: 원본 파일을 읽을 수 없습니다 (${e instanceof Error ? e.message : String(e)})`);
      }
      applyOps(json, ops);
      applyKeyOps(json, ops, warnings);
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
  o: { decisions?: Decisions; patches?: Patch[] } = {},
): Promise<Map<string, string>> {
  return (await applyTranslationsDetailed(projectDir, units, store, o)).files;
}
