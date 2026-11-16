// Patches are fixes and additions recorded as changes against the original copy (patches.json): event list
// edits, JSON value changes, new plugins, the game font and the Korean particle plugin. Event and JSON patches record what they expected
// to find (a list hash or the old value); when the original no longer matches, the patch is a conflict and is
// never applied, because it would land in the wrong place.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { getAtPath } from '../extract/plugins.js';
import { openProject, originalDir } from '../project/project.js';
import type { PathSeg } from '../types.js';
import { readJsonFile } from '../util/json.js';
import { listHash, sameContent } from './hash.js';
import { JOSA_PLUGIN_NAME } from './josa.js';
import { validateOps } from './listOps.js';
import type { EventCommand, Patch, PatchStatus } from './types.js';

export const REASON_CHANGED = '원본 이벤트가 기록했을 때와 달라졌어요';
export const REASON_NO_EVENT = '원본에 그 이벤트가 없어요';
export const REASON_PLUGIN_EXISTS = '같은 이름의 플러그인이 이미 있어요';
export const REASON_NO_FONT = '폰트 파일을 찾을 수 없어요';
export const REASON_VALUE_CHANGED = '원본 값이 기록했을 때와 달라졌어요';
export const REASON_NO_FILE = '원본에 그 파일이 없어요';
export const REASON_BAD_PLUGIN_NAME = '플러그인 이름에 쓸 수 없는 글자가 있어요';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Paths of every event command list in a data file: map event pages, common events and troop pages.
 * Other files have none.
 */
export function eventListPaths(file: string, root: unknown): PathSeg[][] {
  const out: PathSeg[][] = [];
  const name = file.replace(/^.*\//, '');
  if (/^Map\d+\.json$/i.test(name) && isObj(root) && Array.isArray(root.events)) {
    root.events.forEach((ev, i) => {
      if (isObj(ev) && Array.isArray(ev.pages)) {
        ev.pages.forEach((pg, j) => { if (isObj(pg) && Array.isArray(pg.list)) out.push(['events', i, 'pages', j, 'list']); });
      }
    });
  } else if (/^CommonEvents\.json$/i.test(name) && Array.isArray(root)) {
    root.forEach((ev, i) => { if (isObj(ev) && Array.isArray(ev.list)) out.push([i, 'list']); });
  } else if (/^Troops\.json$/i.test(name) && Array.isArray(root)) {
    root.forEach((t, i) => {
      if (isObj(t) && Array.isArray(t.pages)) {
        t.pages.forEach((pg, j) => { if (isObj(pg) && Array.isArray(pg.list)) out.push([i, 'pages', j, 'list']); });
      }
    });
  }
  return out;
}

/** A plugin name that is safe as a file name under js/plugins/. */
export function validPluginName(name: string): boolean {
  return /^[^\\/:*?"<>|.][^\\/:*?"<>|]*$/.test(name) && !name.includes('..');
}

/**
 * Whether each patch would be applied now. A patch whose target in the original copy differs from what was
 * recorded is a conflict and is never applied (it would land in the wrong place).
 */
export async function patchStatuses(projectDir: string, patches: Patch[]): Promise<PatchStatus[]> {
  const meta = await openProject(projectDir);
  const root = originalDir(projectDir, meta);
  const cache = new Map<string, unknown>();
  const read = async (file: string): Promise<unknown> => {
    if (!cache.has(file)) {
      let v: unknown;
      try {
        v = await readJsonFile(path.join(root, ...file.split('/')));
      } catch {
        v = undefined;
      }
      cache.set(file, v);
    }
    return cache.get(file);
  };

  const out: PatchStatus[] = [];
  for (const p of patches) {
    const conflict = (reason: string) => out.push({ id: p.id, state: 'conflict', reason });
    if (!p.enabled) {
      out.push({ id: p.id, state: 'disabled' });
      continue;
    }
    const b = p.body;
    if (b.kind === 'event') {
      const list = getAtPath(await read(b.file), b.listPath);
      if (!Array.isArray(list)) conflict(REASON_NO_EVENT);
      else if (listHash(list) !== b.baseHash) conflict(REASON_CHANGED);
      else {
        const problem = validateOps(list as EventCommand[], b.ops);
        if (problem) conflict(problem);
        else out.push({ id: p.id, state: 'applied' });
      }
    } else if (b.kind === 'json') {
      const data = await read(b.file);
      if (data === undefined) conflict(REASON_NO_FILE);
      else if (!sameContent(getAtPath(data, b.path), b.baseValue)) conflict(REASON_VALUE_CHANGED);
      else out.push({ id: p.id, state: 'applied' });
    } else if (b.kind === 'plugin') {
      if (!validPluginName(b.name)) conflict(REASON_BAD_PLUGIN_NAME);
      else if (existsSync(path.join(root, 'js', 'plugins', `${b.name}.js`))) conflict(REASON_PLUGIN_EXISTS);
      else if (!existsSync(path.join(root, 'js', 'plugins.js'))) conflict(REASON_NO_FILE);
      else out.push({ id: p.id, state: 'applied' });
    } else if (b.kind === 'josa') {
      if (existsSync(path.join(root, 'js', 'plugins', `${JOSA_PLUGIN_NAME}.js`))) conflict(REASON_PLUGIN_EXISTS);
      else if (!existsSync(path.join(root, 'js', 'plugins.js'))) conflict(REASON_NO_FILE);
      else out.push({ id: p.id, state: 'applied' });
    } else if (b.kind === 'font') {
      if (!b.fontPath || !existsSync(b.fontPath)) conflict(REASON_NO_FONT);
      else out.push({ id: p.id, state: 'applied' });
    } else conflict('모르는 수정 종류예요');
  }
  return out;
}

/** The patches that would be applied now. */
export async function appliedPatches(projectDir: string, patches: Patch[]): Promise<Patch[]> {
  if (patches.length === 0) return [];
  const st = await patchStatuses(projectDir, patches);
  return patches.filter((_, i) => st[i].state === 'applied');
}
