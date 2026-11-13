import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { listHash } from '../../src/core/patches/hash.js';
import { applyOps, indexOfOrigin, tagList, untagList, validateOps } from '../../src/core/patches/listOps.js';
import { loadPatches, newPatchId, savePatches } from '../../src/core/patches/store.js';
import type { EventCommand, ListOp, Patch } from '../../src/core/patches/types.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';

afterAll(cleanupTempDirs);

const base = (): EventCommand[] => [0, 1, 2, 3, 4].map((n) => ({ code: 230, indent: 0, parameters: [n] }));
const fresh = (tag: string): EventCommand => ({ code: 121, indent: 0, parameters: [tag] });
const marks = (list: EventCommand[]) => list.map((c) => c.parameters[0]);

test('listHash 는 키 순서와 공백이 아니라 내용을 본다', () => {
  const a = JSON.parse('[{"code":101,"indent":0,"parameters":["", 0, 0, 2]}]');
  const b = JSON.parse('[ { "parameters": ["",0,0,2], "indent": 0, "code": 101 } ]');
  const c = JSON.parse('[{"code":101,"indent":0,"parameters":["", 0, 0, 1]}]');
  expect(listHash(a)).toBe(listHash(b));
  expect(listHash(a)).not.toBe(listHash(c));
  expect(listHash(a)).toMatch(/^[0-9a-f]{40}$/);
});

test('insert after 1 → 길이 7, 번호로 원본 자리를 찾는다', () => {
  const r = applyOps(tagList(base()), [{ op: 'insert', after: 1, commands: [fresh('a'), fresh('b')] }]);
  expect(r).toHaveLength(7);
  expect(marks(r)).toEqual([0, 1, 'a', 'b', 2, 3, 4]);
  expect(indexOfOrigin(r, 3)).toBe(5);
});

test('delete at 2', () => {
  const r = applyOps(tagList(base()), [{ op: 'delete', at: 2 }]);
  expect(r).toHaveLength(4);
  expect(indexOfOrigin(r, 2)).toBe(-1);
  expect(indexOfOrigin(r, 4)).toBe(3);
});

test('replace at 0 으로 2개', () => {
  const r = applyOps(tagList(base()), [{ op: 'replace', at: 0, commands: [fresh('a'), fresh('b')] }]);
  expect(marks(r).slice(0, 3)).toEqual(['a', 'b', 1]);
  expect('__o' in r[0]).toBe(false);
  expect('__o' in r[1]).toBe(false);
  expect(indexOfOrigin(r, 0)).toBe(-1);
});

test('insert after -1 은 맨 앞, 같은 after 는 적힌 순서', () => {
  const r = applyOps(tagList(base()), [
    { op: 'insert', after: -1, commands: [fresh('front')] },
    { op: 'insert', after: 3, commands: [fresh('x')] },
    { op: 'insert', after: 3, commands: [fresh('y')] },
  ]);
  expect(marks(r)).toEqual(['front', 0, 1, 2, 3, 'x', 'y', 4]);
});

test('연산끼리 번호에 영향을 주지 않는다', () => {
  const ins: ListOp = { op: 'insert', after: 1, commands: [fresh('a')] };
  const del: ListOp = { op: 'delete', at: 3 };
  const r1 = applyOps(tagList(base()), [ins, del]);
  const r2 = applyOps(tagList(base()), [del, ins]);
  expect(marks(r1)).toEqual([0, 1, 'a', 2, 4]);
  expect(marks(r2)).toEqual(marks(r1));
});

test('없는 번호를 가리키면 오류', () => {
  expect(() => applyOps(tagList(base()), [{ op: 'delete', at: 9 }])).toThrow('수정이 가리키는 줄이 없습니다: 9');
});

test('validateOps', () => {
  expect(validateOps(base(), [{ op: 'delete', at: 99 }])).toContain('범위');
  expect(validateOps(base(), [{ op: 'delete', at: 2 }, { op: 'replace', at: 2, commands: [fresh('a')] }])).toContain('2');
  expect(validateOps(base(), [{ op: 'insert', after: 1, commands: [{ code: 'x' } as unknown as EventCommand] }])).not.toBeNull();
  expect(validateOps(base(), [{ op: 'insert', after: -1, commands: [fresh('a')] }, { op: 'delete', at: 4 }])).toBeNull();
});

test('untagList 뒤에 __o 가 없다', () => {
  const r = untagList(applyOps(tagList(base()), [{ op: 'insert', after: 0, commands: [fresh('a')] }]));
  expect(JSON.stringify(r)).not.toContain('__o');
  expect(r[0]).toEqual({ code: 230, indent: 0, parameters: [0] });
});

test('tagList 는 원래 목록을 바꾸지 않는다', () => {
  const list = base();
  tagList(list);
  expect(JSON.stringify(list)).not.toContain('__o');
});

test('patches.json 저장과 읽기', async () => {
  const dir = await makeTempDir();
  expect(await loadPatches(dir)).toEqual([]);
  const p: Patch = {
    id: newPatchId(), title: '스위치 켜기', note: '', enabled: true, originalBug: true, createdBy: 'user', createdAt: '2026-11-13T00:00:00.000Z',
    body: { kind: 'event', file: 'data/Map001.json', listPath: ['events', 1, 'pages', 0, 'list'], baseHash: 'x', ops: [{ op: 'delete', at: 1 }] },
  };
  await savePatches(dir, [p]);
  expect(await loadPatches(dir)).toEqual([p]);
  expect(JSON.parse(await readFile(path.join(dir, 'patches.json'), 'utf8'))).toBeTruthy();
  expect(newPatchId()).not.toBe(newPatchId());
});
