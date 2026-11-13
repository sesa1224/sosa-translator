import { mkdir, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { listFonts, systemFontDirs } from '../../src/main/fonts/catalog.js';
import { LoadedFont, readFontInfo, type FontInfo } from '../../src/main/fonts/fontFile.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';
import { makeTestFont } from '../helpers/testFont.js';

afterAll(cleanupTempDirs);

const HANGUL3 = { 가: 900, 힣: 900, 뷁: 900 };

test('readFontInfo: 한국어 이름, 굵기, 한글 여부', async () => {
  const dir = await makeTempDir();
  const few = await makeTestFont(dir, { name: 'Sample Sans', nameKo: '시험 고딕', glyphs: { 가: 900, 나: 880, A: 600, ' ': 250 } });
  const info = await readFontInfo(few);
  expect(info).toMatchObject({ path: few, family: 'Sample Sans', displayName: '시험 고딕', style: 'Regular', hasHangul: false });
  const full = await makeTestFont(dir, { name: 'Full Hangul', style: 'Bold', glyphs: HANGUL3 });
  expect(await readFontInfo(full)).toMatchObject({ displayName: 'Full Hangul', style: 'Bold', hasHangul: true });
  const broken = path.join(dir, 'broken.ttf');
  await writeFile(broken, 'x');
  expect(await readFontInfo(broken)).toBeNull();
  expect(await readFontInfo(path.join(dir, 'none.ttf'))).toBeNull();
});

test('LoadedFont.measure: 글자 폭 합, 없는 글자는 글자 크기만큼', async () => {
  const dir = await makeTempDir();
  const file = await makeTestFont(dir, { name: 'M', glyphs: { 가: 900, A: 600, ' ': 250 } });
  const f = await LoadedFont.load(file);
  expect(f.measure('가A', 20)).toEqual({ width: ((900 + 600) * 20) / 1000, missing: 0 });
  expect(f.measure('가힣', 20)).toEqual({ width: (900 * 20) / 1000 + 20, missing: 1 });
  expect(f.has('가')).toBe(true);
  expect(f.has('힣')).toBe(false);
  // A space or a control character the font lacks is not counted as missing.
  const noSpace = await LoadedFont.load(await makeTestFont(dir, { name: 'N', glyphs: { 가: 900 } }));
  expect(noSpace.measure('가 가', 10).missing).toBe(0);
});

test('listFonts: .ttf 를 읽고 .ttc 는 세기만, 깨진 파일은 빠진다, source 는 폴더에 따라', async () => {
  const sys = await makeTempDir();
  const game = await makeTempDir();
  const proj = await makeTempDir();
  await makeTestFont(sys, { name: 'Beta', nameKo: '베타', glyphs: HANGUL3 });
  await makeTestFont(sys, { name: 'Alpha', glyphs: { A: 600 } });
  await writeFile(path.join(sys, 'collection.ttc'), 'not really');
  await writeFile(path.join(sys, 'broken.ttf'), 'x');
  await writeFile(path.join(sys, 'readme.txt'), 'hi');
  await mkdir(path.join(game, 'fonts'));
  await makeTestFont(path.join(game, 'fonts'), { name: 'GameFont', glyphs: HANGUL3 });
  await makeTestFont(proj, { name: 'ProjFont', glyphs: HANGUL3, file: 'proj.otf' });
  const cacheFile = path.join(await makeTempDir(), 'fonts-cache.json');

  const sysOnly = await listFonts({ systemDirs: [sys], cacheFile });
  // displayName order in the Korean locale (Hangul first).
  expect(sysOnly.fonts.map((f) => f.displayName)).toEqual(['베타', 'Alpha']);
  expect(sysOnly.skippedCollections).toBe(1);

  const all = await listFonts({ systemDirs: [sys, path.join(sys, 'missing-dir')], gameContentDir: game, projectFontsDir: proj, cacheFile });
  const bySource = Object.fromEntries(all.fonts.map((f) => [f.family, f.source]));
  expect(bySource).toEqual({ Alpha: 'system', Beta: 'system', GameFont: 'game', ProjFont: 'project' });
});

test('listFonts: 두 번째 호출은 바뀐 파일만 다시 읽는다', async () => {
  const sys = await makeTempDir();
  const a = await makeTestFont(sys, { name: 'A1', glyphs: { A: 600 } });
  await makeTestFont(sys, { name: 'B1', glyphs: { A: 600 } });
  const cacheFile = path.join(await makeTempDir(), 'cache.json');
  const readCalls: string[] = [];
  const readInfo = async (p: string): Promise<FontInfo | null> => { readCalls.push(p); return readFontInfo(p); };

  const first = await listFonts({ systemDirs: [sys], cacheFile, readInfo });
  expect(first.fonts).toHaveLength(2);
  expect(readCalls).toHaveLength(2);

  readCalls.length = 0;
  const second = await listFonts({ systemDirs: [sys], cacheFile, readInfo });
  expect(second.fonts).toEqual(first.fonts);
  expect(readCalls).toHaveLength(0);

  const later = new Date(Date.now() + 60_000);
  await utimes(a, later, later);
  readCalls.length = 0;
  await listFonts({ systemDirs: [sys], cacheFile, readInfo });
  expect(readCalls).toEqual([a]);
});

test('systemFontDirs: 윈도우 글꼴 폴더 두 곳', () => {
  const dirs = systemFontDirs();
  expect(dirs).toHaveLength(2);
  expect(dirs[0].toLowerCase()).toMatch(/fonts$/);
  expect(dirs[1].toLowerCase()).toMatch(/microsoft[\\/]windows[\\/]fonts$/);
});
