import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeEach, expect, test } from 'vitest';
import { GameRunner } from '../../src/main/gameRun.js';
import { cleanupTempDirs, hashDir, makeTempDir } from '../helpers/fs.js';

afterAll(cleanupTempDirs);

let game: string;
let proj: string;
let patchDir: string;
let calls: { cmd: string; args: readonly string[]; cwd: string | undefined }[];
let children: (EventEmitter & { kill(): void })[];

const fakeSpawn = ((cmd: string, args: readonly string[], opts: { cwd?: string }) => {
  calls.push({ cmd, args, cwd: opts?.cwd });
  const child = Object.assign(new EventEmitter(), { kill() { child.emit('exit', 0); }, unref() {} });
  children.push(child);
  return child;
}) as never;

async function put(root: string, rel: string, text: string): Promise<void> {
  const f = path.join(root, ...rel.split('/'));
  await mkdir(path.dirname(f), { recursive: true });
  await writeFile(f, text);
}

beforeEach(async () => {
  calls = [];
  children = [];
  game = await makeTempDir();
  proj = await makeTempDir();
  patchDir = await makeTempDir();
  for (const [rel, text] of Object.entries({
    'Game.exe': 'exe', 'nw.dll': 'dll', 'index.html': '<html>', 'package.json': '{}',
    'data/Items.json': '[null]', 'data/Map001.json': '{}', 'js/plugins.js': 'var $plugins = [];',
    'img/pictures/a.png': 'PNG-A', 'audio/se/b.ogg': 'OGG', 'locales/ko.pak': 'pak', 'save/file1.rpgsave': 'SAVE-ORIG',
  })) await put(game, rel, text);
});

const runner = () => new GameRunner({ projectDir: proj, gameDir: game, spawn: fakeSpawn });
const copyOf = (rel: string) => path.join(proj, 'testplay', ...rel.split('/'));

test('prepare: 무거운 파일은 하드 링크, 데이터는 복사', async () => {
  const r = await runner().prepare(patchDir);
  for (const rel of ['Game.exe', 'nw.dll', 'index.html', 'data/Items.json', 'img/pictures/a.png', 'audio/se/b.ogg', 'locales/ko.pak', 'save/file1.rpgsave']) {
    expect(existsSync(copyOf(rel))).toBe(true);
  }
  expect((await stat(copyOf('img/pictures/a.png'))).ino).toBe((await stat(path.join(game, 'img/pictures/a.png'))).ino);
  expect((await stat(copyOf('Game.exe'))).ino).toBe((await stat(path.join(game, 'Game.exe'))).ino);
  expect((await stat(copyOf('data/Items.json'))).ino).not.toBe((await stat(path.join(game, 'data/Items.json'))).ino);
  expect(r.linked).toBeGreaterThanOrEqual(5);
  expect(r.copied).toBeGreaterThanOrEqual(6);
});

test('패치 파일이 사본에 덮어써지고 원본은 그대로, 링크된 파일은 링크를 끊고 쓴다', async () => {
  const before = await hashDir(game);
  await put(patchDir, 'data/Items.json', '[null,{"name":"월광초"}]');
  await put(patchDir, 'img/pictures/a.png', 'PNG-KO');
  const r = await runner().prepare(patchDir);
  expect(r.patched).toBe(2);
  expect(await readFile(copyOf('data/Items.json'), 'utf8')).toBe('[null,{"name":"월광초"}]');
  expect(await readFile(copyOf('img/pictures/a.png'), 'utf8')).toBe('PNG-KO');
  expect(await readFile(path.join(game, 'img/pictures/a.png'), 'utf8')).toBe('PNG-A');
  expect(await hashDir(game)).toBe(before);
});

test('사본의 세이브는 다시 prepare 해도 남고 원본 세이브는 바뀌지 않는다', async () => {
  const g = runner();
  await g.prepare(patchDir);
  await writeFile(copyOf('save/file1.rpgsave'), 'SAVE-PLAY');
  await writeFile(copyOf('save/config.rpgsave'), 'CONFIG');
  await g.prepare(patchDir);
  expect(await readFile(copyOf('save/file1.rpgsave'), 'utf8')).toBe('SAVE-PLAY');
  expect(await readFile(path.join(game, 'save/file1.rpgsave'), 'utf8')).toBe('SAVE-ORIG');
  expect(existsSync(path.join(game, 'save/config.rpgsave'))).toBe(false);
});

test('두 번째 prepare 는 바뀌지 않은 파일을 다시 복사하지 않는다', async () => {
  await runner().prepare(patchDir);
  const r = await runner().prepare(patchDir);
  expect(r.copied).toBe(0);
  expect(r.linked).toBe(0);
});

test('지난 패치에 있던 파일이 이번에 없으면 원본 내용으로 돌아온다', async () => {
  await put(patchDir, 'data/Items.json', '[null,{"name":"월광초"}]');
  await put(patchDir, 'img/pictures/a.png', 'PNG-KO');
  await runner().prepare(patchDir);
  const next = await makeTempDir();
  await put(next, 'data/Map001.json', '{"x":1}');
  await runner().prepare(next);
  expect(await readFile(copyOf('data/Items.json'), 'utf8')).toBe('[null]');
  expect(await readFile(copyOf('img/pictures/a.png'), 'utf8')).toBe('PNG-A');
  expect(await readFile(copyOf('data/Map001.json'), 'utf8')).toBe('{"x":1}');
});

test('prepare 전후로 원본 폴더의 해시가 같다', async () => {
  const before = await hashDir(game);
  await put(patchDir, 'data/Items.json', 'X');
  const g = runner();
  await g.prepare(patchDir);
  await g.prepare(patchDir);
  expect(await hashDir(game)).toBe(before);
});

test('launch 는 사본의 Game.exe 를 사본 폴더에서 실행하고 두 번은 안 된다', async () => {
  const g = runner();
  await g.prepare(patchDir);
  const exits: number[] = [];
  g.on('exit', () => exits.push(1));
  await g.launch();
  expect(calls).toHaveLength(1);
  expect(calls[0].cmd).toBe(copyOf('Game.exe'));
  expect(calls[0].cwd).toBe(path.join(proj, 'testplay'));
  expect(g.running).toBe(true);
  await expect(g.launch()).rejects.toThrow('게임이 이미 실행 중입니다');
  g.stop();
  expect(g.running).toBe(false);
  expect(exits).toEqual([1]);
});

test('Game.exe 가 없으면 nw.exe, 둘 다 없으면 오류', async () => {
  const g = runner();
  await expect(g.launch()).rejects.toThrow('실행 파일을 찾을 수 없습니다(Game.exe)');
  await mkdir(path.join(proj, 'testplay'), { recursive: true });
  await writeFile(path.join(proj, 'testplay', 'nw.exe'), '');
  await g.launch();
  expect(calls[0].cmd).toBe(path.join(proj, 'testplay', 'nw.exe'));
});
