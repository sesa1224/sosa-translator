import path from 'node:path';
import { openProject, originalDir } from '../project/project.js';
import { readJsonFile } from '../util/json.js';

/** Names of game data by id (index = id), read from the original copy. Missing entries are ''. */
export interface NameTable {
  switches: string[]; variables: string[]; actors: string[]; items: string[]; weapons: string[]; armors: string[];
  skills: string[]; states: string[]; commonEvents: string[]; maps: Record<number, string>; troops: string[]; enemies: string[];
}

export function emptyNames(): NameTable {
  return { switches: [], variables: [], actors: [], items: [], weapons: [], armors: [], skills: [], states: [], commonEvents: [], maps: {}, troops: [], enemies: [] };
}

/** Database array ([null, {id, name}, ...]) or System string list → names by index. */
function namesOf(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => {
    if (typeof x === 'string') return x;
    const n = (x as { name?: unknown } | null)?.name;
    return typeof n === 'string' ? n : '';
  });
}

/** Reads every name table from the project's original copy. A missing or broken file gives an empty list. */
export async function loadNames(projectDir: string): Promise<NameTable> {
  const meta = await openProject(projectDir);
  const data = path.join(originalDir(projectDir, meta), 'data');
  const read = async (name: string): Promise<unknown> => {
    try {
      return await readJsonFile(path.join(data, name));
    } catch {
      return null;
    }
  };
  const system = ((await read('System.json')) ?? {}) as { switches?: unknown; variables?: unknown };
  const maps: Record<number, string> = {};
  const infos = await read('MapInfos.json');
  if (Array.isArray(infos)) {
    infos.forEach((m, i) => {
      const n = (m as { name?: unknown } | null)?.name;
      if (typeof n === 'string') maps[i] = n;
    });
  }
  return {
    switches: namesOf(system.switches), variables: namesOf(system.variables),
    actors: namesOf(await read('Actors.json')), items: namesOf(await read('Items.json')),
    weapons: namesOf(await read('Weapons.json')), armors: namesOf(await read('Armors.json')),
    skills: namesOf(await read('Skills.json')), states: namesOf(await read('States.json')),
    commonEvents: namesOf(await read('CommonEvents.json')), maps,
    troops: namesOf(await read('Troops.json')), enemies: namesOf(await read('Enemies.json')),
  };
}

/** ' [name]' when the table has a non-empty name for id, else ''. */
export function bracketName(list: string[] | Record<number, string>, id: unknown): string {
  if (typeof id !== 'number') return '';
  const n = (list as Record<number, string>)[id];
  return typeof n === 'string' && n !== '' ? ` [${n}]` : '';
}

/** 'id [name]' or just the id. */
export function idName(list: string[] | Record<number, string>, id: unknown): string {
  return `${String(id)}${bracketName(list, id)}`;
}

/**
 * Map event page conditions as text, or null when the page has none.
 * Copied from src/main/story.ts (pageCondition) so core does not depend on main; a test checks both agree.
 */
export function describeConditions(conditions: unknown, n: NameTable): string | null {
  const c = conditions as Record<string, unknown> | undefined;
  if (!c || typeof c !== 'object') return null;
  const parts: string[] = [];
  if (c.switch1Valid) parts.push(`스위치 ${c.switch1Id}${bracketName(n.switches, c.switch1Id)} 켜짐`);
  if (c.switch2Valid) parts.push(`스위치 ${c.switch2Id}${bracketName(n.switches, c.switch2Id)} 켜짐`);
  if (c.variableValid) parts.push(`변수 ${c.variableId}${bracketName(n.variables, c.variableId)} ≥ ${c.variableValue}`);
  if (c.selfSwitchValid) parts.push(`셀프 스위치 ${c.selfSwitchCh} 켜짐`);
  if (c.itemValid) parts.push(`아이템${bracketName(n.items, c.itemId) || ` ${c.itemId}`} 가짐`);
  if (c.actorValid) parts.push(`액터${bracketName(n.actors, c.actorId) || ` ${c.actorId}`} 있음`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** The autorun/parallel switch of a common event as text, or null (same words as the story view). */
export function describeCommonTrigger(ev: unknown, n: NameTable): string | null {
  const e = ev as { trigger?: unknown; switchId?: unknown } | null;
  if (!e || typeof e !== 'object') return null;
  if ((e.trigger === 1 || e.trigger === 2) && typeof e.switchId === 'number' && e.switchId > 0) {
    return `스위치 ${e.switchId}${bracketName(n.switches, e.switchId)} 켜짐일 때 자동 실행`;
  }
  return null;
}
