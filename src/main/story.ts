import path from 'node:path';
import { getAtPath } from '../core/extract/plugins.js';
import { openProject, originalDir } from '../core/project/project.js';
import { splitSpeaker } from '../core/text/speaker.js';
import type { PathSeg, TextUnit, UnitRef } from '../core/types.js';
import { readJsonFile } from '../core/util/json.js';
import type { SceneInfo, SceneLine } from '../shared/api.js';
import { locationLabel } from '../shared/rows.js';

/** What a scene shows: spoken lines, choices and scrolling text (name boxes and plugin commands are left out). */
const STORY_KINDS = new Set<TextUnit['kind']>(['dialogue', 'choice', 'scroll']);

const segKey = (s: PathSeg): string | number => (typeof s === 'object' ? s.key : s);

/** The command list a ref lives in and its place there; null for refs outside an event command list. */
function placeOf(ref: UnitRef): { listPath: PathSeg[]; order: number; group?: number } | null {
  if (ref.type === 'lines') return { listPath: ref.listPath, order: ref.start };
  if (ref.type === 'choice') return { listPath: ref.listPath, order: ref.index + (ref.choice + 1) / 1000, group: ref.index };
  // Note tags and plugin-file strings (plan 3b) are not part of an event's command list.
  if (ref.type !== 'value') return null;
  const p = ref.path;
  for (let i = 0; i + 1 < p.length; i++) {
    if (segKey(p[i]) === 'list' && typeof segKey(p[i + 1]) === 'number') return { listPath: p.slice(0, i + 1), order: segKey(p[i + 1]) as number };
  }
  return null;
}

/** Numbers in the list path, for sorting scenes as the file holds them. */
function pathOrder(a: PathSeg[], b: PathSeg[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] === undefined ? undefined : segKey(a[i]);
    const y = b[i] === undefined ? undefined : segKey(b[i]);
    if (x === y) continue;
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (typeof x === 'number' && typeof y === 'number') return x - y;
    return String(x).localeCompare(String(y));
  }
  return 0;
}

interface Names { switches: unknown[]; variables: unknown[]; items: unknown[]; actors: unknown[] }

function nameAt(list: unknown[], i: unknown): string {
  if (typeof i !== 'number') return '';
  const v = list[i];
  if (typeof v === 'string') return v;
  const n = (v as { name?: unknown } | null)?.name;
  return typeof n === 'string' ? n : '';
}

const named = (n: string) => (n ? ` [${n}]` : '');

/** Map event page conditions as text, or null when the page has none. */
function pageCondition(c: Record<string, unknown> | undefined, names: Names): string | null {
  if (!c || typeof c !== 'object') return null;
  const parts: string[] = [];
  if (c.switch1Valid) parts.push(`스위치 ${c.switch1Id}${named(nameAt(names.switches, c.switch1Id))} 켜짐`);
  if (c.switch2Valid) parts.push(`스위치 ${c.switch2Id}${named(nameAt(names.switches, c.switch2Id))} 켜짐`);
  if (c.variableValid) parts.push(`변수 ${c.variableId}${named(nameAt(names.variables, c.variableId))} ≥ ${c.variableValue}`);
  if (c.selfSwitchValid) parts.push(`셀프 스위치 ${c.selfSwitchCh} 켜짐`);
  if (c.itemValid) parts.push(`아이템${named(nameAt(names.items, c.itemId)) || ` ${c.itemId}`} 가짐`);
  if (c.actorValid) parts.push(`액터${named(nameAt(names.actors, c.actorId)) || ` ${c.actorId}`} 있음`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * The scenes of one file for the story view: units grouped by the command list they are in (one map event page,
 * common event or troop page), in list order. Only dialogue, choices and scrolling text are shown.
 */
export async function buildScenes(projectDir: string, units: TextUnit[], file: string, pattern: string | null): Promise<SceneInfo[]> {
  const groups = new Map<string, { listPath: PathSeg[]; firstRef: UnitRef; lines: SceneLine[] }>();
  for (const u of units) {
    if (!STORY_KINDS.has(u.kind)) continue;
    for (const ref of u.refs) {
      if (ref.file !== file) continue;
      const place = placeOf(ref);
      if (!place) continue;
      const key = `${file}#${JSON.stringify(place.listPath)}`;
      let g = groups.get(key);
      if (!g) {
        g = { listPath: place.listPath, firstRef: ref, lines: [] };
        groups.set(key, g);
      }
      const speaker = u.speaker ? u.speaker : u.kind === 'dialogue' ? splitSpeaker(u.source, pattern).speaker : null;
      const line: SceneLine = { id: u.id, kind: u.kind, order: place.order, speaker };
      if (place.group !== undefined) line.choiceGroup = place.group;
      g.lines.push(line);
    }
  }
  if (groups.size === 0) return [];

  const meta = await openProject(projectDir);
  const data = path.join(originalDir(projectDir, meta), 'data');
  const read = async (name: string): Promise<unknown> => {
    try {
      return await readJsonFile(path.join(data, name));
    } catch {
      return null;
    }
  };
  const root = await read(file.replace(/^data\//i, ''));
  const system = ((await read('System.json')) ?? {}) as { switches?: unknown; variables?: unknown };
  const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
  const names: Names = { switches: arr(system.switches), variables: arr(system.variables), items: arr(await read('Items.json')), actors: arr(await read('Actors.json')) };
  const isCommon = /CommonEvents\.json$/i.test(file);
  const isMap = /Map\d+\.json$/i.test(file);

  const out: SceneInfo[] = [];
  for (const [key, g] of groups) {
    let condition: string | null = null;
    // The page or common event that owns the list: the path without its last 'list' segment.
    const owner = getAtPath(root, g.listPath.slice(0, -1)) as Record<string, unknown> | undefined;
    if (owner && typeof owner === 'object') {
      if (isMap) condition = pageCondition(owner.conditions as Record<string, unknown> | undefined, names);
      else if (isCommon && (owner.trigger === 1 || owner.trigger === 2) && typeof owner.switchId === 'number' && owner.switchId > 0) {
        condition = `스위치 ${owner.switchId}${named(nameAt(names.switches, owner.switchId))} 켜짐일 때 자동 실행`;
      }
    }
    const label = locationLabel({ id: '', kind: 'dialogue', source: '', needsDecision: false, refs: [g.firstRef] });
    out.push({ key, file, label, condition, lines: g.lines.sort((a, b) => a.order - b.order) });
  }
  const paths = new Map([...groups].map(([k, g]) => [k, g.listPath]));
  return out.sort((a, b) => pathOrder(paths.get(a.key)!, paths.get(b.key)!));
}
