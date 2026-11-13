import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { createProject } from '../../src/core/project/project.js';
import { ensureOriginals, listGameFiles } from '../../src/core/project/originals.js';
import { readJsonFile, writeJsonFile } from '../../src/core/util/json.js';
import { makeMiniGame } from '../helpers/miniGame.js';
import { cleanupTempDirs, hashDir, makeTempDir } from '../helpers/fs.js';

let game: string;
let proj: string;
let gameHashBefore: string;
const orig = () => path.join(proj, 'original', 'v1');

beforeAll(async () => {
  game = await makeTempDir();
  proj = path.join(await makeTempDir(), 'proj');
  await makeMiniGame(game);
  for (const f of ['img/pictures/a.png', 'img/pictures/sub/b.png', 'audio/se/Bell.ogg', 'movies/op.webm']) {
    await mkdir(path.dirname(path.join(game, f)), { recursive: true });
    await writeFile(path.join(game, f), '');
  }
  await writeFile(path.join(game, 'index.html'), '<html><head><title>霧の薬草園</title></head></html>');
  await writeFile(path.join(game, 'package.json'), JSON.stringify({ name: 'kiri', window: { title: '霧の薬草園' } }));
  gameHashBefore = await hashDir(game);
  await createProject(game, proj, '약초원');
});
afterAll(cleanupTempDirs);

test('게임 파일 목록', async () => {
  const files = await listGameFiles(game);
  expect(files).toEqual(expect.arrayContaining(['img/pictures/a.png', 'img/pictures/sub/b.png', 'audio/se/Bell.ogg', 'movies/op.webm']));
  expect(files.some((f) => f.startsWith('data/'))).toBe(false);
});

test('새 프로젝트에 files.json, index.html, package.top.json 이 있다', async () => {
  for (const f of ['files.json', 'index.html', 'package.top.json']) expect(existsSync(path.join(orig(), f))).toBe(true);
  expect(await readJsonFile(path.join(orig(), 'files.json'))).toContain('img/pictures/a.png');
  expect(await readFile(path.join(orig(), 'index.html'), 'utf8')).toContain('<title>霧の薬草園</title>');
  expect(await readJsonFile(path.join(orig(), 'package.top.json'))).toEqual({ name: 'kiri', window: { title: '霧の薬草園' } });
});

test('지운 파일을 ensureOriginals 가 다시 채운다', async () => {
  for (const f of ['files.json', 'index.html', 'package.top.json']) await rm(path.join(orig(), f));
  const r = await ensureOriginals(proj);
  expect(r.missingGameDir).toBe(false);
  expect([...r.added].sort()).toEqual(['files.json', 'index.html', 'package.top.json']);
  for (const f of ['files.json', 'index.html', 'package.top.json']) expect(existsSync(path.join(orig(), f))).toBe(true);
  expect(await ensureOriginals(proj)).toEqual({ added: [], missingGameDir: false });
});

test('게임 폴더가 없으면 missingGameDir 이고 예외가 없다', async () => {
  const meta = (await readJsonFile(path.join(proj, 'project.json'))) as Record<string, unknown>;
  await writeJsonFile(path.join(proj, 'project.json'), { ...meta, gameDir: path.join(game, 'no-such-dir') });
  await rm(path.join(orig(), 'index.html'));
  const r = await ensureOriginals(proj);
  expect(r).toEqual({ added: [], missingGameDir: true });
  await writeJsonFile(path.join(proj, 'project.json'), meta);
});

test('원본 게임 폴더는 바뀌지 않는다', async () => {
  expect(await hashDir(game)).toBe(gameHashBefore);
});
