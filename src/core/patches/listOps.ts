import type { EventCommand, ListOp } from './types.js';

/** A command carrying its original position (__o). Commands a patch added carry none. */
export type TaggedCommand = EventCommand & { __o?: number };

/** Copies of the commands, each tagged with its original index. The given list is not changed. */
export function tagList(list: EventCommand[]): TaggedCommand[] {
  return list.map((c, i) => (c && typeof c === 'object' ? { ...c, __o: i } : c));
}

/** The commands without their tags. */
export function untagList(list: TaggedCommand[]): EventCommand[] {
  return list.map((c) => {
    if (!c || typeof c !== 'object' || !('__o' in c)) return c;
    const { __o: _drop, ...rest } = c;
    return rest;
  });
}

/** Current position of the command that was at origin in the original list, or -1 when it is gone. */
export function indexOfOrigin(list: TaggedCommand[], origin: number): number {
  return list.findIndex((c) => !!c && typeof c === 'object' && c.__o === origin);
}

const copy = (cmds: EventCommand[]): TaggedCommand[] => cmds.map((c) => structuredClone({ code: c.code, indent: c.indent, parameters: c.parameters }));

/**
 * Applies ops whose numbers are original positions. Each op is placed by its original position, so ops do not
 * shift each other and their order in the list does not matter (except inserts at the same place, kept in order).
 */
export function applyOps(tagged: TaggedCommand[], ops: ListOp[]): TaggedCommand[] {
  const present = new Set(tagged.map((c) => c?.__o).filter((o): o is number => typeof o === 'number'));
  const inserts = new Map<number, EventCommand[]>();
  const deleted = new Set<number>();
  const replaced = new Map<number, EventCommand[]>();
  for (const op of ops) {
    const at = op.op === 'insert' ? op.after : op.at;
    if (!(op.op === 'insert' && at === -1) && !present.has(at)) throw new Error(`수정이 가리키는 줄이 없습니다: ${at}`);
    if (op.op === 'insert') inserts.set(at, [...(inserts.get(at) ?? []), ...op.commands]);
    else if (op.op === 'delete') deleted.add(at);
    else replaced.set(at, op.commands);
  }
  const out: TaggedCommand[] = copy(inserts.get(-1) ?? []);
  for (const c of tagged) {
    const o = c?.__o;
    if (typeof o !== 'number') {
      out.push(c);
      continue;
    }
    const r = replaced.get(o);
    if (r) out.push(...copy(r));
    else if (!deleted.has(o)) out.push(c);
    out.push(...copy(inserts.get(o) ?? []));
  }
  return out;
}

function badCommands(cmds: unknown): boolean {
  if (!Array.isArray(cmds) || cmds.length === 0) return true;
  return cmds.some((c) => {
    const x = c as EventCommand | null;
    return !x || typeof x !== 'object' || !Number.isInteger(x.code) || !Number.isInteger(x.indent) || x.indent < 0 || !Array.isArray(x.parameters);
  });
}

/** The first problem of ops against the original list, as one Korean line, or null when they can be applied. */
export function validateOps(list: EventCommand[], ops: ListOp[]): string | null {
  if (!Array.isArray(ops) || ops.length === 0) return '연산이 없습니다';
  const touched = new Set<number>();
  for (const op of ops) {
    if (!op || typeof op !== 'object') return '연산의 모양이 틀렸습니다';
    if (op.op === 'insert') {
      if (!Number.isInteger(op.after) || op.after < -1 || op.after >= list.length) return `수정이 가리키는 줄이 범위 밖입니다: ${op.after} (0~${list.length - 1})`;
      if (badCommands(op.commands)) return '끼워 넣을 커맨드의 모양이 틀렸습니다 (code, indent, parameters)';
    } else if (op.op === 'delete' || op.op === 'replace') {
      if (!Number.isInteger(op.at) || op.at < 0 || op.at >= list.length) return `수정이 가리키는 줄이 범위 밖입니다: ${op.at} (0~${list.length - 1})`;
      if (touched.has(op.at)) return `같은 줄을 두 번 지우거나 바꿀 수 없습니다: ${op.at}`;
      touched.add(op.at);
      if (op.op === 'replace' && badCommands(op.commands)) return '바꿀 커맨드의 모양이 틀렸습니다 (code, indent, parameters)';
    } else return `모르는 연산입니다: ${String((op as { op?: unknown }).op)}`;
  }
  return null;
}
