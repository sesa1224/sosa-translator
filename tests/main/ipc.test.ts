import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { ProjectService } from '../../src/main/projectService.js';
import { nameFromTitle, registerIpc, UNPACKED_FOLDER_NAME, type ChatLike, type IpcDeps } from '../../src/main/ipc.js';
import { saveSettings, loadSettings } from '../../src/main/settings.js';
import type { ChatImage, Row } from '../../src/shared/api.js';
import { currentContainer, fakeExe, itemsFromDir } from '../helpers/evbPack.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';
import { makeMiniGame } from '../helpers/miniGame.js';

class FakeChat extends EventEmitter implements ChatLike {
  sent: { text: string; images: ChatImage[] }[] = [];
  busy = false; sessionId = null; model = '';
  send(text: string, images: ChatImage[] = []) { this.sent.push({ text, images }); }
  stop() {} reset() {} dispose() {}
  setModel(m: string) { this.model = m; }
}

const handlers = new Map<string, (e: unknown, ...a: any[]) => any>();
const broadcasts: { channel: string; payload: any }[] = [];
let fakeChat: FakeChat;
let game: string;
let id: string;
let deps: IpcDeps;

const invoke = async (channel: string, ...args: any[]): Promise<any> => {
  const h = handlers.get(channel);
  if (!h) throw new Error(`no handler: ${channel}`);
  return h({}, ...args);
};
const sent = (channel: string) => broadcasts.filter((b) => b.channel === channel).map((b) => b.payload);

beforeAll(async () => {
  game = await makeTempDir();
  await makeMiniGame(game);
  const settingsDir = await makeTempDir();
  const projectsDir = await makeTempDir();
  await saveSettings(settingsDir, { ...(await loadSettings(settingsDir)), projectsDir });
  deps = {
    ipcMain: { handle: (channel, fn) => { handlers.set(channel, fn); } },
    pickDirectory: async () => game,
    settingsDir,
    holder: { svc: null },
    broadcast: (channel, payload) => { broadcasts.push({ channel, payload }); },
    createChat: () => { fakeChat = new FakeChat(); return fakeChat; },
    claudePath: () => 'C:/fake/claude.exe',
    showItemInFolder: () => {},
  };
  registerIpc(deps);
});
afterAll(async () => { await invoke('project:close'); await cleanupTempDirs(); });

test('설정은 읽고 고치면 알린다', async () => {
  expect((await invoke('settings:get')).theme).toBe('dark');
  expect((await invoke('settings:set', { theme: 'light' })).theme).toBe('light');
  expect(sent('settings:changed').at(-1)).toMatchObject({ theme: 'light' });
});
test('만들고, 고치면 변경 알림에 바뀐 행만 온다', async () => {
  await invoke('project:create', game, '약초원'); const snap = await invoke('project:snapshot');
  expect(snap.rows.length).toBeGreaterThan(5); id = snap.rows.find((r: Row) => r.source === '月光草').id;
  await invoke('unit:setTranslation', id, '월광초');
  expect(sent('project:changed').at(-1)).toMatchObject({ origin: 'user', rows: [{ id, target: '월광초' }], stats: { translated: 1, needsReview: 0 } });
});
test('붙은 항목이 채팅 글 앞에 들어간다', async () => {
  await invoke('chat:send', '이 줄 좀 더 밝게', [], id);
  expect(fakeChat.sent[0].text).toMatch(/^\[붙은 항목\] id=.+ 위치=Items · 1\n원문: 月光草\n번역: 월광초\n\n이 줄 좀 더 밝게$/);
});
test('같은 이름의 프로젝트가 있으면 오류', async () => { await expect(invoke('project:create', game, '약초원')).rejects.toThrow('프로젝트 폴더가 비어있지 않습니다'); });

// Extra coverage beyond the plan's assertions.
test('스냅숏의 게임 제목, 목록, 항목 읽기, 되돌리기, 채팅 되돌리기, 빌드', async () => {
  const snap = await invoke('project:snapshot');
  expect(snap.gameTitle).toBe('霧の薬草園'); expect(snap.meta.name).toBe('약초원');
  expect(await invoke('project:list')).toEqual([expect.objectContaining({ name: '약초원', engine: 'MZ' })]);
  const u = await invoke('unit:get', id);
  expect(u).toMatchObject({ row: { id, target: '월광초' }, issues: [], refs: ['Items · 1'] });
  await invoke('unit:setStatus', id, 'approved');
  expect(sent('project:changed').at(-1).rows[0].status).toBe('approved');
  expect(await invoke('chat:undo')).toEqual([]);
  expect(await invoke('project:undo')).toEqual([id]);
  const b = await invoke('project:build');
  expect(b.files.map((f: any) => f.path)).toEqual(['data/Items.json', '패치노트.txt', '설치 방법.txt']);
  expect(await invoke('project:pickGameDir')).toBe(game);
  await invoke('chat:setModel', 'claude-haiku-5-5');
  expect(fakeChat.model).toBe('claude-haiku-5-5'); expect((await invoke('settings:get')).chatModel).toBe('claude-haiku-5-5');
  fakeChat.emit('event', { type: 'text', text: '안녕' });
  expect(sent('chat:event').at(-1)).toEqual({ type: 'text', text: '안녕' });
  await invoke('project:close'); expect(deps.holder.svc).toBeNull();
  await invoke('project:open', path.join((await invoke('settings:get')).projectsDir, '약초원'));
  expect((await invoke('project:snapshot')).rows.find((r: Row) => r.id === id).target).toBe('월광초');
  await expect(invoke('project:create', game, '  ')).rejects.toThrow('프로젝트 이름을 입력하세요');
});
test('만들기가 중간에 실패하면 만들던 폴더를 지운다', async () => {
  // Creation fails after the project folder was made (e.g. a copy error halfway).
  const spy = vi.spyOn(ProjectService, 'create').mockImplementationOnce(async (_g, dir) => { await mkdir(path.join(dir, 'original'), { recursive: true }); throw new Error('복사 실패'); });
  await expect(invoke('project:create', game, '깨진 게임')).rejects.toThrow('복사 실패');
  spy.mockRestore();
  expect(existsSync(path.join((await invoke('settings:get')).projectsDir, '깨진 게임'))).toBe(false);
});
test('게임 폴더 확인: 제목, 이름 다듬기, 파일이면 그 폴더, 게임이 아니면 오류', async () => {
  const titled = await makeTempDir();
  await makeMiniGame(titled);
  const sys = path.join(titled, 'data', 'System.json');
  const json = JSON.parse(readFileSync(sys, 'utf8')); json.gameTitle = ' A/B: C? '; writeFileSync(sys, JSON.stringify(json));
  expect(await invoke('project:inspectGameDir', titled)).toEqual({ ok: true, dir: path.resolve(titled), engine: 'MZ', title: 'A/B: C?', suggestedName: 'AB C' });
  expect(await invoke('project:inspectGameDir', path.join(game, 'data', 'System.json'))).toMatchObject({ ok: false });
  writeFileSync(path.join(titled, 'Game.exe'), '');
  expect(await invoke('project:inspectGameDir', path.join(titled, 'Game.exe'))).toMatchObject({ ok: true, dir: path.resolve(titled), suggestedName: 'AB C' });
  const notGame = await makeTempDir();
  expect(await invoke('project:inspectGameDir', notGame)).toMatchObject({ ok: false, error: expect.stringContaining('rmmz_core.js') });
  expect(nameFromTitle(' ...', 'folder.')).toBe('folder');
});

test('뭉친 exe 게임: 폴더 확인이 알려 주고, 풀면 게임 폴더가 된다', async () => {
  const src = await makeTempDir();
  await makeMiniGame(src);
  const shipped = path.join(await makeTempDir(), '뭉친 게임');
  await mkdir(shipped, { recursive: true });
  const exe = path.join(shipped, 'Game.exe');
  writeFileSync(exe, fakeExe(currentContainer(await itemsFromDir(src))));
  const before = readFileSync(exe);

  const check = await invoke('project:inspectGameDir', shipped);
  expect(check).toMatchObject({ ok: false, packed: { exe } });
  expect(check.packed.files).toBeGreaterThan(3);
  // dropping the exe itself means its folder
  expect(await invoke('project:inspectGameDir', exe)).toMatchObject({ ok: false, packed: { exe } });

  const dir = await invoke('project:unpackGame', exe);
  expect(dir).toBe(path.join((await invoke('settings:get')).projectsDir, UNPACKED_FOLDER_NAME, '뭉친 게임'));
  expect(await invoke('project:inspectGameDir', dir)).toMatchObject({ ok: true, engine: 'MZ' });
  expect(readFileSync(path.join(dir, 'data', 'System.json')).equals(readFileSync(path.join(src, 'data', 'System.json')))).toBe(true);
  expect(readFileSync(exe).equals(before)).toBe(true);
  // a second call uses what is already there
  expect(await invoke('project:unpackGame', exe)).toBe(dir);
  // the unpacked games folder is not listed as a project
  expect((await invoke('project:list')).some((p: { dir: string }) => p.dir.includes(UNPACKED_FOLDER_NAME))).toBe(false);

  await expect(invoke('project:unpackGame', path.join(src, 'data', 'System.json'))).rejects.toThrow('뭉친 exe 가 아닙니다');
});

test('표기 경고 표시는 바뀐 행과 규칙이 바뀔 때 다시 계산한다', async () => {
  await invoke('project:create', game, '표기');
  const snap = await invoke('project:snapshot');
  const moon = snap.rows.find((r: Row) => r.source === '月光草').id;
  expect(snap.rows.some((r: Row) => r.notation)).toBe(false);
  await invoke('unit:setTranslation', moon, '월광초♥');
  expect(sent('project:changed').at(-1)).toMatchObject({ rows: [{ id: moon, notation: true }], stats: { notation: 1 } });
  await invoke('glossary:setRules', { notationCheck: false });
  await vi.waitFor(() => expect(sent('project:changed').at(-1)).toMatchObject({ rows: [{ id: moon }], stats: { notation: 0 } }));
  expect(sent('project:changed').at(-1).rows[0].notation).toBeUndefined();
});
