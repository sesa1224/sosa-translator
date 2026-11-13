import { describe, expect, test } from 'vitest';
import { alignLists, rebaseOps, rebasePatch } from '../../src/core/update/rebase.js';
import { listHash } from '../../src/core/patches/hash.js';
import type { EventCommand, ListOp, Patch, PatchBody } from '../../src/core/patches/types.js';

const text = (t: string, indent = 0): EventCommand => ({ code: 401, indent, parameters: [t] });
const wait = (n: number): EventCommand => ({ code: 230, indent: 0, parameters: [n] });
const sw = (id: number): EventCommand => ({ code: 121, indent: 0, parameters: [id, id, 0] });
const end: EventCommand = { code: 0, indent: 0, parameters: [] };
const describeCmd = (c: EventCommand) => (c.code === 401 ? `문장: ${String(c.parameters[0])}` : `코드 ${c.code}`);

const base = (): EventCommand[] => [text('a'), text('b'), text('c'), text('d'), text('e'), text('f'), text('g'), end];

function eventPatch(list: EventCommand[], ops: ListOp[]): Patch {
  return {
    id: 'p-1', title: '스위치 켜기', note: '', enabled: true, originalBug: true, createdBy: 'user', createdAt: '2026-01-01T00:00:00.000Z',
    body: { kind: 'event', file: 'data/Map001.json', listPath: ['events', 1, 'pages', 0, 'list'], baseHash: listHash(list), ops },
  };
}

describe('alignLists', () => {
  test('앞에 커맨드 2개가 더해지면 번호가 2씩 밀린다', () => {
    const old = base();
    const next = [wait(10), wait(20), ...old];
    expect(alignLists(old, next)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });
  test('가운데 하나가 지워지면 그 자리가 null', () => {
    const old = base();
    const next = old.filter((_, i) => i !== 3);
    expect(alignLists(old, next)).toEqual([0, 1, 2, null, 3, 4, 5, 6]);
  });
  test('같은 커맨드가 여러 번 나와도 순서를 지킨다', () => {
    const old = [text('はい'), text('いいえ'), text('はい'), text('はい'), end];
    const next = [text('はい'), wait(5), text('いいえ'), text('はい'), text('はい'), end];
    expect(alignLists(old, next)).toEqual([0, 2, 3, 4, 5]);
  });
  test('들여쓰기가 다르면 다른 커맨드', () => {
    expect(alignLists([text('a', 0), end], [text('a', 1), end])).toEqual([null, 1]);
  });
});

describe('rebaseOps', () => {
  test('끼워 넣기, 지우기, 바꾸기의 번호가 옮겨진다', () => {
    const old = base();
    const next = [wait(10), wait(20), ...old];
    const r = rebaseOps(old, next, [
      { op: 'insert', after: 5, commands: [sw(1)] }, { op: 'delete', at: 1 }, { op: 'replace', at: 2, commands: [text('C')] }, { op: 'insert', after: -1, commands: [sw(2)] },
    ]);
    expect(r).toEqual({ ok: true, ops: [
      { op: 'insert', after: 7, commands: [sw(1)] }, { op: 'delete', at: 3 }, { op: 'replace', at: 4, commands: [text('C')] }, { op: 'insert', after: -1, commands: [sw(2)] },
    ] });
  });
  test('가리키던 줄이 사라지면 실패하고 이유에 풀어쓴 글이 있다', () => {
    const old = base();
    const next = old.filter((_, i) => i !== 3);
    const r = rebaseOps(old, next, [{ op: 'delete', at: 3 }], describeCmd);
    expect(r).toEqual({ ok: false, reason: '수정이 가리키던 줄이 새 버전에 없어요(3번: 문장: d)' });
  });
  test('끼워 넣을 자리 바로 뒤의 커맨드가 바뀌면 실패', () => {
    const old = base();
    const next = old.map((c, i) => (i === 6 ? text('G') : c));
    const r = rebaseOps(old, next, [{ op: 'insert', after: 5, commands: [sw(1)] }], describeCmd);
    expect(r).toEqual({ ok: false, reason: '끼워 넣을 자리의 앞뒤가 바뀌었어요(5번 뒤)' });
  });
});

describe('rebasePatch', () => {
  test('옛 5번 뒤에 끼워 넣던 수정이 새 7번 뒤로 옮겨진다', () => {
    const old = base();
    const next = [wait(10), wait(20), ...old];
    const p = eventPatch(old, [{ op: 'insert', after: 5, commands: [sw(1)] }]);
    const r = rebasePatch(p, { oldList: old, newList: next, describe: describeCmd });
    expect(r.result).toBe('moved');
    const b = r.patch.body as Extract<PatchBody, { kind: 'event' }>;
    expect(b.ops).toEqual([{ op: 'insert', after: 7, commands: [sw(1)] }]);
    expect(b.baseHash).toBe(listHash(next));
    expect((p.body as Extract<PatchBody, { kind: 'event' }>).baseHash).toBe(listHash(old));
  });
  test('지우던 줄이 사라지면 conflict 와 이유', () => {
    const old = base();
    const next = old.filter((_, i) => i !== 3);
    const p = eventPatch(old, [{ op: 'delete', at: 3 }]);
    const r = rebasePatch(p, { oldList: old, newList: next, describe: describeCmd });
    expect(r.result).toBe('conflict');
    expect(r.reason).toBe('수정이 가리키던 줄이 새 버전에 없어요(3번: 문장: d)');
    expect(r.patch).toEqual(p);
  });
  test('끼워 넣을 자리 뒤가 바뀌면 conflict', () => {
    const old = base();
    const next = old.map((c, i) => (i === 6 ? text('G') : c));
    const r = rebasePatch(eventPatch(old, [{ op: 'insert', after: 5, commands: [sw(1)] }]), { oldList: old, newList: next, describe: describeCmd });
    expect(r.result).toBe('conflict');
    expect(r.reason).toContain('끼워 넣을 자리의 앞뒤가 바뀌었어요');
  });
  test('목록이 그대로면 unchanged 이고 patch 가 같다', () => {
    const old = base();
    const p = eventPatch(old, [{ op: 'insert', after: 5, commands: [sw(1)] }]);
    const r = rebasePatch(p, { oldList: old, newList: structuredClone(old), describe: describeCmd });
    expect(r.result).toBe('unchanged');
    expect(r.patch).toEqual(p);
  });
  test('새 목록이 없으면 conflict', () => {
    const old = base();
    const r = rebasePatch(eventPatch(old, [{ op: 'delete', at: 1 }]), { oldList: old, newList: undefined, describe: describeCmd });
    expect(r).toMatchObject({ result: 'conflict', reason: '원본에 그 이벤트가 없어요' });
  });
  test('json 수정: 값이 그대로면 unchanged, 바뀌었으면 conflict', () => {
    const p: Patch = {
      id: 'p-2', title: '가격', note: '', enabled: true, originalBug: false, createdBy: 'user', createdAt: '', body: { kind: 'json', file: 'data/Items.json', path: [1, 'price'], baseValue: 100, value: 50 },
    };
    const oldJson = [null, { id: 1, price: 100 }];
    expect(rebasePatch(p, { oldJson, newJson: [null, { price: 100, id: 1 }], describe: describeCmd }).result).toBe('unchanged');
    const r = rebasePatch(p, { oldJson, newJson: [null, { id: 1, price: 120 }], describe: describeCmd });
    expect(r).toMatchObject({ result: 'conflict', reason: '원본 값이 바뀌었어요' });
  });
  test('플러그인과 폰트 수정은 unchanged', () => {
    const p: Patch = { id: 'p-3', title: '폰트', note: '', enabled: true, originalBug: false, createdBy: 'user', createdAt: '', body: { kind: 'font', fontPath: 'x.ttf', subset: true } };
    expect(rebasePatch(p, { describe: describeCmd }).result).toBe('unchanged');
  });
});
