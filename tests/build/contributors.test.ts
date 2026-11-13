import { readFile } from 'node:fs/promises';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, expect, test } from 'vitest';
import { buildPatch, type BuildContext } from '../../src/core/build/patch.js';
import { cleanupTempDirs } from '../helpers/fs.js';
import { setupProject, translator } from '../helpers/project.js';

afterAll(cleanupTempDirs);

test('기여자가 준 글과 바이너리 파일이 패치에 들어간다', async () => {
  const { proj, units, store } = await setupProject({ engine: 'MV', www: true });
  translator(units, store)('月光草', '월광초');
  const seen: BuildContext[] = [];
  const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0, 255]);
  const r = await buildPatch(proj, units, store, {
    contributors: [
      async (ctx) => { seen.push(ctx); return new Map<string, string | Uint8Array>([[`${ctx.contentPrefix}img/pictures/a.png`, bytes], ['패치노트.txt', '첫 줄']]); },
      async () => new Map([['패치노트.txt', '나중 것이 이긴다']]),
    ],
  });
  expect(seen[0]).toMatchObject({ contentPrefix: 'www/', number: 1 });
  expect([...seen[0].changed.keys()]).toEqual(['data/Items.json']);
  const zip = unzipSync(await readFile(r.zipPath));
  expect(Object.keys(zip).sort()).toEqual(['www/data/Items.json', 'www/img/pictures/a.png', '패치노트.txt']);
  expect(zip['www/img/pictures/a.png']).toEqual(bytes);
  expect(strFromU8(zip['패치노트.txt'])).toBe('나중 것이 이긴다');
  expect(r.files.filter((f) => f.path === '패치노트.txt')).toHaveLength(1);
});

test('번역이 없어도 기여자가 준 파일만으로 빌드된다', async () => {
  const { proj, units, store } = await setupProject();
  const r = await buildPatch(proj, units, store, { contributors: [async () => new Map([['fonts/a.ttf', Uint8Array.from([1, 2, 3])]])] });
  expect(r.files.map((f) => f.path)).toEqual(['fonts/a.ttf']);
  await expect(buildPatch(proj, units, store, { contributors: [async () => new Map()] })).rejects.toThrow('바뀐 파일이 없습니다');
});
