import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { detectGame } from '../../src/core/engine/detect.js';
import { encryptAsset } from '../../src/core/engine/crypto.js';
import { ImageCatalog, pictureUsage, pngSize, readImage, scanImages } from '../../src/core/images/catalog.js';
import { createProject } from '../../src/core/project/project.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';
import { ENCRYPTION_KEY, makeMiniGame, miniMap } from '../helpers/miniGame.js';
import { makePng } from '../helpers/png.js';

afterAll(cleanupTempDirs);

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47];

/** A mini game whose img/ holds only a.png, sub/b.png, encrypted c.png_ and a text file. */
async function imageGame() {
  const dir = await makeTempDir();
  await makeMiniGame(dir, { encrypted: true });
  await rm(path.join(dir, 'img'), { recursive: true, force: true });
  await mkdir(path.join(dir, 'img', 'pictures', 'sub'), { recursive: true });
  await mkdir(path.join(dir, 'img', 'titles1'), { recursive: true });
  await writeFile(path.join(dir, 'img', 'pictures', 'a.png'), makePng(4, 3, [255, 0, 0, 255]));
  await writeFile(path.join(dir, 'img', 'pictures', 'sub', 'b.png'), makePng(2, 2));
  await writeFile(path.join(dir, 'img', 'titles1', 'c.png_'), encryptAsset(makePng(640, 480), ENCRYPTION_KEY));
  await writeFile(path.join(dir, 'img', 'pictures', 'readme.txt'), 'hello');
  return { dir, game: await detectGame(dir) };
}

test('그림을 찾는다: 하위 폴더와 암호화 파일 포함, 글 파일은 뺀다', async () => {
  const { game } = await imageGame();
  const found = await scanImages(game);
  expect(found.map((f) => [f.file, f.sourceFile, f.encrypted]).sort()).toEqual([
    ['img/pictures/a.png', 'img/pictures/a.png', false],
    ['img/pictures/sub/b.png', 'img/pictures/sub/b.png', false],
    ['img/titles1/c.png', 'img/titles1/c.png_', true],
  ]);
  expect(found.every((f) => f.bytes > 0 && f.mtimeMs > 0)).toBe(true);
});

test('readImage 가 암호화 파일을 풀고, 글 파일은 오류', async () => {
  const { game } = await imageGame();
  const png = await readImage(game, 'img/titles1/c.png_');
  expect([...png.subarray(0, 4)]).toEqual(PNG_HEAD);
  await expect(readImage(game, 'img/pictures/readme.txt')).rejects.toThrow('PNG 파일이 아닙니다: img/pictures/readme.txt');
});

test('pngSize 가 IHDR 에서 크기를 읽는다', () => {
  expect(pngSize(makePng(1, 1))).toEqual({ width: 1, height: 1 });
  expect(pngSize(makePng(640, 480))).toEqual({ width: 640, height: 480 });
});

test('pictureUsage 가 그림 표시(231) 횟수를 센다', async () => {
  const game = await makeTempDir();
  await makeMiniGame(game);
  const map = miniMap();
  const list = map.events[1]!.pages[0].list as unknown[];
  list.splice(0, 0,
    { code: 231, indent: 0, parameters: [1, 'menu', 0, 0, 0, 0, 100, 100, 255, 0] },
    { code: 231, indent: 0, parameters: [2, 'menu', 0, 0, 0, 0, 100, 100, 255, 0] },
    { code: 231, indent: 0, parameters: [3, 'logo', 0, 0, 0, 0, 100, 100, 255, 0] });
  await writeFile(path.join(game, 'data', 'Map001.json'), JSON.stringify(map), 'utf8');
  const proj = path.join(await makeTempDir(), 'proj');
  await createProject(game, proj, '약초원');
  const usage = await pictureUsage(proj);
  expect(usage['img/pictures/menu.png']).toBe(2);
  expect(usage['img/pictures/logo.png']).toBe(1);
});

test('목록은 기억해 두고 바뀐 파일만 다시 읽는다', async () => {
  const { dir, game } = await imageGame();
  const proj = await makeTempDir();
  const cat = new ImageCatalog(proj, game);
  const first = await cat.list();
  expect(first.map((e) => e.file)).toEqual(['img/pictures/a.png', 'img/pictures/sub/b.png', 'img/titles1/c.png']);
  const c = first.find((e) => e.file === 'img/titles1/c.png')!;
  expect(c).toMatchObject({ sourceFile: 'img/titles1/c.png_', encrypted: true, width: 640, height: 480, status: 'none', usedByEvents: 0 });
  expect(c.hash).toMatch(/^[0-9a-f]{40}$/);
  expect(cat.reads).toBe(3);
  expect(existsSync(path.join(proj, 'images', 'catalog.json'))).toBe(true);

  const again = new ImageCatalog(proj, game);
  await again.list();
  expect(again.reads).toBe(0);

  const a = first.find((e) => e.file === 'img/pictures/a.png')!;
  await writeFile(path.join(dir, 'img', 'pictures', 'a.png'), makePng(5, 3, [0, 255, 0, 255]));
  const third = await again.list();
  expect(again.reads).toBe(1);
  const a2 = third.find((e) => e.file === 'img/pictures/a.png')!;
  expect(a2.hash).not.toBe(a.hash);
  expect(a2.width).toBe(5);
  expect([...(await again.bytes('img/titles1/c.png')).subarray(0, 4)]).toEqual(PNG_HEAD);
});

test('그림 폴더가 없으면 빈 목록', async () => {
  const dir = await makeTempDir();
  await makeMiniGame(dir);
  await rm(path.join(dir, 'img'), { recursive: true, force: true });
  const game = await detectGame(dir);
  expect(await scanImages(game)).toEqual([]);
  expect(await new ImageCatalog(await makeTempDir(), game).list()).toEqual([]);
});
