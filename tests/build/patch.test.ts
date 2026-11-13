import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { buildPatch } from '../../src/core/build/patch.js';
import type { TranslationStore } from '../../src/core/store/translations.js';
import type { TextUnit } from '../../src/core/types.js';
import { cleanupTempDirs } from '../helpers/fs.js';
import { setupProject, translator } from '../helpers/project.js';

let proj: string, units: TextUnit[], store: TranslationStore, tr: ReturnType<typeof translator>;
let projMv: string, unitsMv: TextUnit[], storeMv: TranslationStore, tr2: ReturnType<typeof translator>;
let emptyProj: string, emptyUnits: TextUnit[], emptyStore: TranslationStore;

beforeAll(async () => {
  ({ proj, units, store } = await setupProject());
  tr = translator(units, store);
  ({ proj: projMv, units: unitsMv, store: storeMv } = await setupProject({ engine: 'MV', www: true }));
  tr2 = translator(unitsMv, storeMv);
  ({ proj: emptyProj, units: emptyUnits, store: emptyStore } = await setupProject());
});
afterAll(cleanupTempDirs);

test('바뀐 파일만 묶는다', async () => {
  tr('月光草', '월광초'); const r = await buildPatch(proj, units, store);
  expect(r.number).toBe(1); expect(r.files.map(f => f.path)).toEqual(['data/Items.json']);
  expect(Object.keys(unzipSync(await readFile(r.zipPath)))).toEqual(['data/Items.json']);
  expect(path.basename(r.zipPath)).toBe('약초원_patch_001.zip');
  // Extra: build folder layout.
  expect(existsSync(path.join(proj, 'builds/001/patch/data/Items.json'))).toBe(true);
  const manifest = JSON.parse(await readFile(path.join(proj, 'builds/001/manifest.json'), 'utf8'));
  expect(manifest).toMatchObject({ number: 1, version: 'v1', files: r.files });
});
test('번호가 올라간다', async () => { expect((await buildPatch(proj, units, store)).number).toBe(2); });
test('MV www 는 경로 앞에 www/', async () => {
  tr2('月光草', '월광초'); expect((await buildPatch(projMv, unitsMv, storeMv)).files[0].path).toBe('www/data/Items.json');
});
test('오류 항목은 빼고 센다', async () => {
  tr('やった！', 'やった!'); const r = await buildPatch(proj, units, store);
  expect(r.skippedErrors).toBe(1); expect(r.files.map(f => f.path)).toEqual(['data/Items.json']);
});
test('바뀐 게 없으면 오류', async () => { await expect(buildPatch(emptyProj, emptyUnits, emptyStore)).rejects.toThrow('바뀐 파일이 없습니다'); });
