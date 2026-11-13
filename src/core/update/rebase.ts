import { getAtPath } from '../extract/plugins.js';
import { REASON_NO_EVENT, REASON_NO_FILE } from '../patches/apply.js';
import { canonicalJson, listHash, sameContent } from '../patches/hash.js';
import type { EventCommand, ListOp, Patch } from '../patches/types.js';

export const REASON_VALUE_CHANGED_UPDATE = '원본 값이 바뀌었어요';
export const REASON_EVENT_CHANGED_BEFORE = '수정이 이전 버전에서도 맞지 않았어요';

/** Above this many table cells the middle part is matched in order without the full LCS (keeps memory small). */
const MAX_LCS_CELLS = 16_000_000;

const keyOf = (c: EventCommand): string => (c && typeof c === 'object' ? canonicalJson({ code: c.code, indent: c.indent, parameters: c.parameters }) : canonicalJson(c));

/**
 * Old index → new index of the same command (code, indent and parameters), or null when it is gone. An LCS keeps the
 * order, so a line said twice is matched to the right one. The same start and end are matched first.
 */
export function alignLists(oldList: EventCommand[], newList: EventCommand[]): (number | null)[] {
  const a = oldList.map(keyOf);
  const b = newList.map(keyOf);
  const out: (number | null)[] = new Array(a.length).fill(null);
  let pre = 0;
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) {
    out[pre] = pre;
    pre++;
  }
  let suf = 0;
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) {
    out[a.length - 1 - suf] = b.length - 1 - suf;
    suf++;
  }
  const n = a.length - pre - suf;
  const m = b.length - pre - suf;
  if (n === 0 || m === 0) return out;

  if (n * m > MAX_LCS_CELLS) {
    // Very long changed middle: take each old command's next occurrence in order.
    let j = pre;
    for (let i = pre; i < pre + n; i++) {
      for (let k = j; k < pre + m; k++) {
        if (b[k] === a[i]) {
          out[i] = k;
          j = k + 1;
          break;
        }
      }
    }
    return out;
  }

  const w = m + 1;
  const t = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      t[i * w + j] = a[pre + i] === b[pre + j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[pre + i] === b[pre + j]) {
      out[pre + i] = pre + j;
      i++;
      j++;
    } else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) i++;
    else j++;
  }
  return out;
}

const gone = (at: number, cmd: EventCommand | undefined, describe?: (cmd: EventCommand) => string) =>
  `수정이 가리키던 줄이 새 버전에 없어요(${at}번: ${cmd && describe ? describe(cmd) : '알 수 없는 줄'})`;

/**
 * The ops with their numbers moved to the new list. Every line an op points at must still be there; an insert also
 * needs the line right after its place to still follow it, so it lands between the same two lines. Otherwise the
 * patch is not moved (a near place could be the wrong one).
 */
export function rebaseOps(
  oldList: EventCommand[], newList: EventCommand[], ops: ListOp[], describe?: (cmd: EventCommand) => string,
): { ok: true; ops: ListOp[] } | { ok: false; reason: string } {
  const map = alignLists(oldList, newList);
  const out: ListOp[] = [];
  for (const op of ops) {
    if (op.op === 'insert') {
      if (op.after === -1) {
        out.push(structuredClone(op));
        continue;
      }
      const to = map[op.after];
      if (to === null || to === undefined) return { ok: false, reason: gone(op.after, oldList[op.after], describe) };
      if (op.after + 1 < oldList.length && map[op.after + 1] !== to + 1) return { ok: false, reason: `끼워 넣을 자리의 앞뒤가 바뀌었어요(${op.after}번 뒤)` };
      out.push({ ...structuredClone(op), after: to });
    } else {
      const to = map[op.at];
      if (to === null || to === undefined) return { ok: false, reason: gone(op.at, oldList[op.at], describe) };
      out.push({ ...structuredClone(op), at: to });
    }
  }
  return { ok: true, ops: out };
}

/**
 * What becomes of a patch in a new version. event: the same list is unchanged; a changed one is moved when every op
 * finds its place, else a conflict (the patch stays as it was). json: the same original value is unchanged, another
 * one a conflict. oldJson and newJson are the whole data files of the two versions. plugin and font: unchanged.
 */
export function rebasePatch(
  patch: Patch,
  o: { oldList?: EventCommand[]; newList?: EventCommand[]; oldJson?: unknown; newJson?: unknown; describe: (cmd: EventCommand) => string },
): { result: 'unchanged' | 'moved' | 'conflict'; patch: Patch; reason?: string } {
  const b = patch.body;
  const conflict = (reason: string) => ({ result: 'conflict' as const, patch, reason });
  if (b.kind === 'event') {
    if (!Array.isArray(o.newList)) return conflict(REASON_NO_EVENT);
    if (listHash(o.newList) === b.baseHash) return { result: 'unchanged', patch };
    if (!Array.isArray(o.oldList) || listHash(o.oldList) !== b.baseHash) return conflict(REASON_EVENT_CHANGED_BEFORE);
    const r = rebaseOps(o.oldList, o.newList, b.ops, o.describe);
    if (!r.ok) return conflict(r.reason);
    return { result: 'moved', patch: { ...structuredClone(patch), body: { ...structuredClone(b), ops: r.ops, baseHash: listHash(o.newList) } } };
  }
  if (b.kind === 'json') {
    if (o.newJson === undefined) return conflict(REASON_NO_FILE);
    let now: unknown;
    try {
      now = getAtPath(o.newJson, b.path);
    } catch {
      now = undefined;   // a JSON string inside that no longer parses
    }
    return sameContent(now, b.baseValue) ? { result: 'unchanged', patch } : conflict(REASON_VALUE_CHANGED_UPDATE);
  }
  return { result: 'unchanged', patch };
}
