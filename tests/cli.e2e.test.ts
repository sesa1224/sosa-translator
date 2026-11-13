import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { run } from '../src/cli.js';
import type { TextUnit } from '../src/core/types.js';
import { cleanupTempDirs, hashDir, makeTempDir } from './helpers/fs.js';
import { makeMiniGame } from './helpers/miniGame.js';

let game: string, proj: string, proj2: string, emptyDir: string, outFile: string, inFile: string;
let gameHashBefore: string;

beforeAll(async () => {
  game = await makeTempDir();
  const work = await makeTempDir();
  proj = path.join(work, 'proj');
  proj2 = path.join(work, 'proj2');
  emptyDir = await makeTempDir();
  outFile = path.join(work, 'out.json');
  inFile = path.join(work, 'in.json');
  await makeMiniGame(game);
  gameHashBefore = await hashDir(game);
  // Keep CLI output out of the test log.
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterAll(async () => { vi.restoreAllMocks(); await cleanupTempDirs(); });

async function idOf(source: string): Promise<string> {
  const units = JSON.parse(await readFile(path.join(proj, 'units.json'), 'utf8')) as TextUnit[];
  return units.find((u) => u.source === source)!.id;
}

test('가져오기부터 패치까지', async () => {
  await makeMiniGame(game);
  expect(await run(['import', game, proj, '--name', '약초원'])).toBe(0);
  expect(await run(['export', proj, '--out', outFile])).toBe(0);
  const items = JSON.parse(await readFile(outFile, 'utf8'));
  expect(items.some((i: any) => i.source === '記録')).toBe(false);
  const ko: Record<string, string> = { '月光草': '월광초', 'リナ': '리나', 'いいよ': '좋아', 'また今度': '다음에' };
  await writeFile(inFile, JSON.stringify(items.filter((i: any) => ko[i.source]).map((i: any) => ({ id: i.id, target: ko[i.source] }))));
  expect(await run(['apply', proj, inFile])).toBe(0);
  expect(await run(['check', proj])).toBe(0);
  expect(await run(['build', proj])).toBe(0);
  const zip = unzipSync(await readFile(path.join(proj, 'builds/001/약초원_patch_001.zip')));
  expect(Object.keys(zip).sort()).toEqual(['data/Actors.json', 'data/Items.json', 'data/Map001.json']);
  expect(await hashDir(game)).toBe(gameHashBefore);
});
test('검사 오류는 종료 코드 1', async () => {
  await writeFile(inFile, JSON.stringify([{ id: await idOf('やった！'), target: 'やった' }]));
  await run(['apply', proj, inFile]); expect(await run(['check', proj])).toBe(1);
});
test('MV/MZ가 아닌 폴더', async () => { expect(await run(['import', emptyDir, proj2, '--name', 'x'])).toBe(1); });
test('인자 부족', async () => { expect(await run(['build'])).toBe(2); });

// Extra coverage.
test('상태, 모르는 명령, 잘못된 번역 파일', async () => {
  expect(await run(['status', proj])).toBe(0);
  expect(await run(['nope'])).toBe(2);
  expect(await run([])).toBe(2);
  await writeFile(inFile, '{"not":"array"}');
  expect(await run(['apply', proj, inFile])).toBe(1);
});
