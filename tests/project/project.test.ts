import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createProject, openProject, originalDir } from '../../src/core/project/project.js';
import { extractAll, mergeUnits } from '../../src/core/extract/index.js';
import { makeMiniGame, miniItems } from '../helpers/miniGame.js';
import { cleanupTempDirs, hashDir, makeTempDir } from '../helpers/fs.js';

let game: string;
let proj: string;
let gameHashBefore: string;
const itemsJson = JSON.stringify(miniItems());

beforeAll(async () => {
  game = await makeTempDir();
  proj = path.join(await makeTempDir(), 'proj');
  await makeMiniGame(game);
  gameHashBefore = await hashDir(game);
});
afterAll(cleanupTempDirs);

test('프로젝트를 만들고 원본을 복사한다', async () => {
  await makeMiniGame(game); const m = await createProject(game, proj, '약초원');
  expect(m).toMatchObject({ name: '약초원', engine: 'MZ', current: 'v1', contentPrefix: '' });
  expect(existsSync(path.join(proj, 'original/v1/data/Map001.json'))).toBe(true);
  expect(existsSync(path.join(proj, 'original/v1/js/plugins.js'))).toBe(true);
  expect(await openProject(proj)).toEqual(m);
  expect(originalDir(proj, m)).toBe(path.join(proj, 'original', 'v1'));
});
test('비어있지 않은 폴더에는 만들지 않는다', async () => {
  await writeFile(path.join(proj, 'x.txt'), ''); await expect(createProject(game, proj, 'a')).rejects.toThrow('프로젝트 폴더가 비어있지 않습니다');
});
test('전체 추출: 합치기와 저장', async () => {
  const { units, warnings } = await extractAll(proj);
  expect(warnings).toEqual([]);
  const rina = units.filter(u => u.source === 'リナ' && u.kind === 'db');
  expect(rina).toHaveLength(1); expect(rina[0].refs).toHaveLength(3); // 액터 1 + 화자 2
  expect(units.find(u => u.source === '記録')!.needsDecision).toBe(true);
  expect(new Set(units.map(u => u.id)).size).toBe(units.length);
  expect(JSON.parse(await readFile(path.join(proj, 'units.json'), 'utf8'))).toEqual(units);
});
test('BOM 붙은 파일은 읽고, 깨진 파일은 경고만', async () => {
  await writeFile(path.join(proj, 'original/v1/data/Items.json'), '﻿' + itemsJson);
  await writeFile(path.join(proj, 'original/v1/data/Skills.json'), '{깨짐');
  const { units, warnings } = await extractAll(proj);
  expect(units.some(u => u.source === '月光草')).toBe(true);
  expect(warnings).toEqual([{ file: 'data/Skills.json', message: expect.stringContaining('읽을 수 없') }]);
});
test('원본 게임 폴더는 바뀌지 않는다', async () => { expect(await hashDir(game)).toBe(gameHashBefore); });

// Extra coverage for mergeUnits.
test('합치기: 같은 종류+화자+원문만 하나로, 순서 유지', () => {
  const ref = (n: number) => ({ type: 'value' as const, file: 'f', path: [n] });
  const merged = mergeUnits([
    { kind: 'db', source: 'あ', needsDecision: false, ref: ref(0) },
    { kind: 'dialogue', source: 'あ', speaker: 'X', needsDecision: false, ref: ref(1) },
    { kind: 'db', source: 'あ', needsDecision: true, ref: ref(2) },
    { kind: 'dialogue', source: 'あ', needsDecision: false, ref: ref(3) },
  ]);
  expect(merged.map(u => [u.kind, u.speaker, u.refs.length, u.needsDecision])).toEqual([
    ['db', undefined, 2, true], ['dialogue', 'X', 1, false], ['dialogue', undefined, 1, false]]);
  expect(merged[0].id).toMatch(/^[0-9a-f]{16}$/);
});
