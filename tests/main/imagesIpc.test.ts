import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, afterEach, expect, test } from 'vitest';
import { registerIpc, type IpcDeps } from '../../src/main/ipc.js';
import { loadSettings, saveSettings } from '../../src/main/settings.js';
import type { BuildRecord, ImageEntry, Row } from '../../src/shared/api.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';
import { makeMiniGame } from '../helpers/miniGame.js';
import { makePng } from '../helpers/png.js';
import { answer } from './jobHelpers.js';

afterAll(cleanupTempDirs);

let disposers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const d of disposers) await d(); disposers = []; });

const RENDERED = makePng(40, 20, [0, 0, 255, 255]);

async function setup() {
  const game = await makeTempDir();
  await makeMiniGame(game);
  await writeFile(path.join(game, 'img', 'pictures', 'menu.png'), makePng(40, 20, [255, 0, 0, 255]));
  const settingsDir = await makeTempDir();
  await saveSettings(settingsDir, { ...(await loadSettings(settingsDir)), projectsDir: await makeTempDir() });
  const handlers = new Map<string, (e: unknown, ...a: any[]) => any>();
  const broadcasts: { channel: string; payload: any }[] = [];
  const shown: string[] = [];
  const deps: IpcDeps = {
    ipcMain: { handle: (channel, fn) => { handlers.set(channel, fn); } },
    pickDirectory: async () => game,
    settingsDir,
    holder: { svc: null },
    broadcast: (channel, payload) => { broadcasts.push({ channel, payload }); },
    createChat: () => null,
    claudePath: () => 'claude',
    showItemInFolder: (f) => { shown.push(f); },
    render: { render: async () => RENDERED, sheet: async () => RENDERED, thumbnail: async (png) => png },
    runJson: answer(() => ({ notes: '약초원 한국어 패치 빌드 1\n- 다듬음' })) as any,
    jsonClaude: () => ({ command: 'claude' }),
  };
  const ipc = registerIpc(deps);
  disposers.push(() => ipc.dispose());
  const invoke = async (channel: string, ...args: any[]): Promise<any> => {
    const h = handlers.get(channel);
    if (!h) throw new Error(`no handler: ${channel}`);
    return h({}, ...args);
  };
  const sent = (channel: string) => broadcasts.filter((b) => b.channel === channel).map((b) => b.payload);
  await invoke('project:create', game, '약초원');
  const rows: Row[] = (await invoke('project:snapshot')).rows;
  const idOf = (source: string) => rows.find((r) => r.source === source)!.id;
  return { game, invoke, sent, idOf, shown };
}

test('그림 목록과 지시서 저장, 바뀐 그림이 알려진다', async () => {
  const { invoke, sent } = await setup();
  const list: ImageEntry[] = await invoke('images:list');
  expect(list.map((e) => e.file)).toEqual(['img/pictures/menu.png']);
  await invoke('images:setRecipe', 'img/pictures/menu.png', [{ rect: { x: 1, y: 1, w: 10, h: 10 }, erase: 'fill', fillColor: '#000000' }]);
  for (let i = 0; i < 50 && sent('images:changed').length === 0; i++) await new Promise((r) => setTimeout(r, 10));
  const changed: ImageEntry[] = sent('images:changed').at(-1);
  expect(changed.map((e) => [e.file, e.status])).toEqual([['img/pictures/menu.png', 'todo']]);
  expect((await invoke('images:recipe', 'img/pictures/menu.png')).regions).toHaveLength(1);
  expect(await invoke('images:full', 'img/pictures/menu.png', 'rendered')).toEqual(RENDERED);
});

test('빌드 기록: 두 번 빌드하면 최신순, 노트 고치기가 zip 에 들어간다', async () => {
  const { invoke, idOf, shown } = await setup();
  await invoke('unit:setTranslation', idOf('月光草'), '월광초');
  await invoke('project:build');
  await invoke('unit:setTranslation', idOf('やった！'), '해냈다!');
  await invoke('images:setRecipe', 'img/pictures/menu.png', [{ rect: { x: 1, y: 1, w: 10, h: 10 }, erase: 'fill', fillColor: '#000000' }]);
  await invoke('images:setStatus', 'img/pictures/menu.png', 'done');
  await invoke('project:build');
  const builds: BuildRecord[] = await invoke('builds:list');
  expect(builds.map((b) => b.number)).toEqual([2, 1]);
  expect(builds[0].notes).toContain('빌드 2');
  expect(builds[0].diff).toMatchObject({ previous: 1, newTranslations: 1, newImages: ['img/pictures/menu.png'] });
  expect(builds[0].files).toBeGreaterThan(0);
  await invoke('builds:setNotes', 2, '고친 글');
  const zip = unzipSync(new Uint8Array(await readFile(builds[0].zipPath)));
  expect(strFromU8(zip['패치노트.txt']).startsWith('고친 글')).toBe(true);
  expect(zip['img/pictures/menu.png']).toEqual(RENDERED);
  expect((await invoke('builds:list'))[0].notes).toBe('고친 글');
  await invoke('builds:openFolder', 1);
  expect(shown.at(-1)).toBe(builds[1].zipPath);
});

test('패치노트 다듬기는 작업으로 돈다', async () => {
  const { invoke, idOf, sent } = await setup();
  await invoke('unit:setTranslation', idOf('月光草'), '월광초');
  await invoke('project:build');
  await invoke('builds:polishNotes', 1);
  for (let i = 0; i < 100 && !sent('job:progress').some((p) => p.kind === 'notes' && p.state === 'done'); i++) await new Promise((r) => setTimeout(r, 10));
  expect(sent('job:progress').some((p) => p.kind === 'notes' && p.state === 'done')).toBe(true);
  expect((await invoke('builds:list'))[0].notes).toContain('- 다듬음');
});

test('전체 다시 찍기는 images 작업으로 진행을 알린다', async () => {
  const { invoke, sent } = await setup();
  await invoke('images:setRecipe', 'img/pictures/menu.png', [{ rect: { x: 1, y: 1, w: 10, h: 10 }, erase: 'fill', fillColor: '#000000' }]);
  await invoke('images:setStatus', 'img/pictures/menu.png', 'done');
  await invoke('images:rerenderAll');
  for (let i = 0; i < 100 && !sent('job:progress').some((p) => p.kind === 'images' && p.state === 'done'); i++) await new Promise((r) => setTimeout(r, 10));
  expect(sent('job:progress').filter((p) => p.kind === 'images').at(-1)).toMatchObject({ state: 'done', done: 1, total: 1 });
});

test('게임 폴더가 없어지면 그림 목록은 비고, 빌드는 그림 없이 된다', async () => {
  const { game, invoke, idOf } = await setup();
  await invoke('project:close');
  await rename(game, game + '-gone');
  const list = await invoke('project:list');
  await invoke('project:open', list[0].dir);
  expect(await invoke('images:list')).toEqual([]);
  await invoke('unit:setTranslation', idOf('月光草'), '월광초');
  const b = await invoke('project:build');
  const zip = unzipSync(new Uint8Array(await readFile(b.zipPath)));
  expect(Object.keys(zip).sort()).toEqual(['data/Items.json', '설치 방법.txt', '패치노트.txt']);
  await rename(game + '-gone', game);
});
