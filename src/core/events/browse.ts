// Read-only access to the event command lists of the project's original copy (or an older version's copy),
// for the events screen and the chat's event tools. describe.ts turns commands into Korean lines; the hash of
// a list (patches/hash.ts) is what an event patch records so a later change of the original can be noticed.
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { getAtPath } from '../extract/plugins.js';
import { listHash } from '../patches/hash.js';
import { eventListPaths } from '../patches/apply.js';
import type { EventCommand } from '../patches/types.js';
import { openProject, originalDir } from '../project/project.js';
import type { PathSeg } from '../types.js';
import { readJsonFile } from '../util/json.js';
import { describeList, type DescribedLine } from './describe.js';
import { bracketName, describeCommonTrigger, describeConditions, loadNames, type NameTable } from './names.js';

export interface EventListInfo { key: string; label: string; listPath: PathSeg[]; pages?: number; condition: string | null; commandCount: number }
export interface EventDetail { label: string; condition: string | null; hash: string; lines: DescribedLine[]; raw: EventCommand[] }
export interface EventFileInfo { file: string; label: string; events: number }

const MAP_FILE = /^Map(\d+)\.json$/i;

/** data/ of the current original copy, or of an older version's copy. */
async function dataDir(projectDir: string, version?: string): Promise<string> {
  const meta = await openProject(projectDir);
  if (version === undefined || version === meta.current) return path.join(originalDir(projectDir, meta), 'data');
  if (!meta.versions.some((v) => v.id === version) || !existsSync(path.join(projectDir, 'original', version))) throw new Error(`없는 버전입니다: ${version}`);
  return path.join(projectDir, 'original', version, 'data');
}

/** A data file of the original copy (or of an older version's copy), or null when it is missing or broken. */
export async function readData(projectDir: string, file: string, version?: string): Promise<unknown> {
  const dir = await dataDir(projectDir, version);
  try {
    return await readJsonFile(path.join(dir, file.replace(/^data\//i, '')));
  } catch {
    return null;
  }
}

/** Data files that hold events, in the order they are shown: maps by number, common events, troops. */
export async function eventFileNames(projectDir: string): Promise<string[]> {
  const dir = await dataDir(projectDir);
  if (!existsSync(dir)) return [];
  const names = await readdir(dir);
  const maps = names.filter((n) => MAP_FILE.test(n)).sort((a, b) => Number(MAP_FILE.exec(a)![1]) - Number(MAP_FILE.exec(b)![1]));
  const rest = ['CommonEvents.json', 'Troops.json'].filter((n) => names.includes(n));
  return [...maps, ...rest].map((n) => `data/${n}`);
}

const seg = (s: PathSeg | undefined): unknown => (typeof s === 'object' && s !== null ? s.key : s);

/** Where a command list is, for people: '맵4 · 이벤트3 · 2페이지', '커먼이벤트1', '적 무리2 · 1페이지'. */
export function listLabel(file: string, listPath: PathSeg[]): string {
  const name = file.replace(/^.*\//, '');
  const map = MAP_FILE.exec(name);
  if (map) return `맵${Number(map[1])} · 이벤트${String(seg(listPath[1]))} · ${Number(seg(listPath[3])) + 1}페이지`;
  if (/^CommonEvents\.json$/i.test(name)) return `커먼이벤트${String(seg(listPath[0]))}`;
  if (/^Troops\.json$/i.test(name)) return `적 무리${String(seg(listPath[0]))} · ${Number(seg(listPath[2])) + 1}페이지`;
  return file;
}

/** The condition that starts a list: a map page's conditions or a common event's autorun switch. */
function conditionOf(file: string, root: unknown, listPath: PathSeg[], n: NameTable): string | null {
  const owner = getAtPath(root, listPath.slice(0, -1));
  if (MAP_FILE.test(file.replace(/^.*\//, ''))) return describeConditions((owner as { conditions?: unknown } | null)?.conditions, n);
  if (/CommonEvents\.json$/i.test(file)) return describeCommonTrigger(owner, n);
  return null;
}

/** Every command list of the project's original copy, in display order. */
export async function* allEventLists(projectDir: string): AsyncGenerator<{ file: string; root: unknown; listPath: PathSeg[]; list: EventCommand[] }> {
  for (const file of await eventFileNames(projectDir)) {
    const root = await readData(projectDir, file);
    for (const listPath of eventListPaths(file, root)) yield { file, root, listPath, list: getAtPath(root, listPath) as EventCommand[] };
  }
}

/** The events of one file: a row per map event page, per common event, per troop page. */
export async function listEvents(projectDir: string, file: string): Promise<EventListInfo[]> {
  const root = await readData(projectDir, file);
  const n = await loadNames(projectDir);
  const isMap = MAP_FILE.test(file.replace(/^.*\//, ''));
  const isCommon = /CommonEvents\.json$/i.test(file);
  return eventListPaths(file, root).map((listPath) => {
    const list = getAtPath(root, listPath) as unknown[];
    const owner = getAtPath(root, listPath.slice(0, 1)) as { name?: unknown; pages?: unknown[] } | null;
    let label: string;
    let pages: number | undefined;
    if (isMap) {
      const ev = getAtPath(root, listPath.slice(0, 2)) as { pages?: unknown[] };
      pages = Array.isArray(ev?.pages) ? ev.pages.length : undefined;
      label = `이벤트 ${String(seg(listPath[1]))} · ${Number(seg(listPath[3])) + 1}페이지`;
    } else if (isCommon) {
      label = `커먼이벤트 ${String(seg(listPath[0]))}${bracketName(n.commonEvents, seg(listPath[0]))}`;
    } else {
      pages = Array.isArray(owner?.pages) ? owner.pages.length : undefined;
      label = `적 무리 ${String(seg(listPath[0]))}${bracketName(n.troops, seg(listPath[0]))} · ${Number(seg(listPath[2])) + 1}페이지`;
    }
    const info: EventListInfo = { key: JSON.stringify(listPath), label, listPath, condition: conditionOf(file, root, listPath, n), commandCount: list.length };
    if (pages !== undefined) info.pages = pages;
    return info;
  });
}

/** One command list, described line by line, with the hash a patch must record. */
export async function readEvent(projectDir: string, file: string, listPath: PathSeg[], version?: string): Promise<EventDetail> {
  const root = await readData(projectDir, file, version);
  const raw = getAtPath(root, listPath);
  if (!Array.isArray(raw)) throw new Error(`이벤트를 찾을 수 없습니다: ${file} ${JSON.stringify(listPath)}`);
  const n = await loadNames(projectDir);
  const list = raw as EventCommand[];
  return { label: listLabel(file, listPath), condition: conditionOf(file, root, listPath, n), hash: listHash(list), lines: describeList(list, n), raw: list };
}

/** Files with events: maps ('맵4 [이름]'), common events and battle events, with how many events each holds. */
export async function eventFiles(projectDir: string): Promise<EventFileInfo[]> {
  const n = await loadNames(projectDir);
  const out: EventFileInfo[] = [];
  for (const file of await eventFileNames(projectDir)) {
    const root = await readData(projectDir, file);
    const name = file.replace(/^.*\//, '');
    const map = MAP_FILE.exec(name);
    if (map) {
      const id = Number(map[1]);
      const events = root && typeof root === 'object' && Array.isArray((root as { events?: unknown }).events)
        ? ((root as { events: unknown[] }).events).filter((e) => e && typeof e === 'object').length : 0;
      out.push({ file, label: `맵${id}${bracketName(n.maps, id)}`, events });
      continue;
    }
    const events = Array.isArray(root) ? root.filter((e) => e && typeof e === 'object').length : 0;
    if (events === 0) continue;
    out.push({ file, label: /CommonEvents/i.test(name) ? '커먼이벤트' : '전투 이벤트', events });
  }
  return out;
}
