import { getAtPath } from '../extract/plugins.js';
import type { EventCommand } from '../patches/types.js';
import type { PathSeg } from '../types.js';
import { allEventLists, listLabel } from './browse.js';
import { describeCommand } from './describe.js';
import { loadNames } from './names.js';

export interface EventRef { file: string; listPath: PathSeg[]; label: string; index: number; text: string; access: 'read' | 'write' }
export type UsageTarget = { type: 'switch' | 'variable' | 'commonEvent' | 'item' | 'picture'; id: number | string };
type Access = EventRef['access'];

const inRange = (id: unknown, a: unknown, b: unknown): boolean =>
  typeof id === 'number' && typeof a === 'number' && typeof b === 'number' && id >= Math.min(a, b) && id <= Math.max(a, b);

/** How one command uses the target (possibly both writing and reading it). */
function commandAccess(c: EventCommand, t: UsageTarget): Access[] {
  const p = Array.isArray(c.parameters) ? c.parameters : [];
  const id = t.id;
  const out: Access[] = [];
  switch (t.type) {
    case 'switch':
      if (c.code === 121 && inRange(id, p[0], p[1])) out.push('write');
      if (c.code === 111 && p[0] === 0 && p[1] === id) out.push('read');
      break;
    case 'variable':
      if (c.code === 122) {
        if (inRange(id, p[0], p[1])) out.push('write');
        if (p[3] === 1 && p[4] === id) out.push('read');
      }
      if (c.code === 111 && p[0] === 1 && (p[1] === id || (p[2] === 1 && p[3] === id))) out.push('read');
      if ((c.code === 103 || c.code === 104) && p[0] === id) out.push('write');
      if (c.code === 201 && p[0] === 1 && (p[1] === id || p[2] === id || p[3] === id)) out.push('read');
      if (c.code === 125 && p[1] === 1 && p[2] === id) out.push('read');
      if ((c.code === 126 || c.code === 127 || c.code === 128) && p[2] === 1 && p[3] === id) out.push('read');
      break;
    case 'commonEvent':
      if (c.code === 117 && p[0] === id) out.push('read');
      break;
    case 'item':
      if (c.code === 126 && p[0] === id) out.push('write');
      if (c.code === 111 && p[0] === 8 && p[1] === id) out.push('read');
      break;
    case 'picture':
      if (c.code === 231 && p[1] === id) out.push('read');
      break;
  }
  return out;
}

/** Whether a list's starting condition (page conditions, a common event's autorun switch) reads the target. */
function conditionReads(file: string, root: unknown, listPath: PathSeg[], t: UsageTarget): boolean {
  const owner = getAtPath(root, listPath.slice(0, -1)) as Record<string, unknown> | null;
  if (!owner || typeof owner !== 'object') return false;
  if (/CommonEvents\.json$/i.test(file)) {
    return t.type === 'switch' && (owner.trigger === 1 || owner.trigger === 2) && owner.switchId === t.id;
  }
  const c = owner.conditions as Record<string, unknown> | undefined;
  if (!c || typeof c !== 'object') return false;
  if (t.type === 'switch') {
    return (!!c.switch1Valid && c.switch1Id === t.id) || (!!c.switch2Valid && c.switch2Id === t.id) || (!!c.switchValid && c.switchId === t.id);
  }
  if (t.type === 'variable') return !!c.variableValid && c.variableId === t.id;
  if (t.type === 'item') return !!c.itemValid && c.itemId === t.id;
  return false;
}

/**
 * Every place in the original copy's events that uses a switch, variable, common event, item or picture:
 * map events, common events and battle events, with page conditions (index -1).
 */
export async function findUsage(projectDir: string, target: UsageTarget): Promise<EventRef[]> {
  const n = await loadNames(projectDir);
  const t: UsageTarget = { type: target.type, id: target.type === 'picture' ? String(target.id) : Number(target.id) };
  const out: EventRef[] = [];
  for await (const { file, root, listPath, list } of allEventLists(projectDir)) {
    const label = listLabel(file, listPath);
    if (conditionReads(file, root, listPath, t)) out.push({ file, listPath, label, index: -1, text: '페이지 조건', access: 'read' });
    list.forEach((c, index) => {
      if (!c || typeof c !== 'object') return;
      for (const access of commandAccess(c, t)) out.push({ file, listPath, label, index, text: describeCommand(c, n), access });
    });
  }
  return out;
}
