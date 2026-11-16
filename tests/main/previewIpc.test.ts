import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, afterAll, expect, test } from 'vitest';
import { encryptAsset } from '../../src/core/engine/crypto.js';
import { registerIpc, type IpcDeps } from '../../src/main/ipc.js';
import { loadSettings, saveSettings } from '../../src/main/settings.js';
import type { Row } from '../../src/shared/api.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';
import { ENCRYPTION_KEY, makeMiniGame } from '../helpers/miniGame.js';
import { makeTestFont } from '../helpers/testFont.js';

afterAll(cleanupTempDirs);

/** Smallest PNG header plus filler (only the first bytes are checked). */
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 1, 2, 3, 4]);

let disposers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const d of disposers) await d(); disposers = []; });

async function setup(o: { encrypted?: boolean; skin?: boolean; pickFont?: string | null } = {}) {
  const game = await makeTempDir();
  await makeMiniGame(game, { encrypted: o.encrypted });
  if (o.skin) {
    const sys = path.join(game, 'img', 'system');
    await mkdir(sys, { recursive: true });
    if (o.encrypted) await writeFile(path.join(sys, 'Window.png_'), encryptAsset(PNG, ENCRYPTION_KEY));
    else await writeFile(path.join(sys, 'Window.png'), PNG);
  }
  const fontDir = await makeTempDir();
  const glyphs: Record<string, number> = { ' ': 250 };
  for (const ch of '가나다월광초') glyphs[ch] = 1000;
  const font = await makeTestFont(fontDir, { name: 'IpcFont', nameKo: '시험체', glyphs });
  const settingsDir = await makeTempDir();
  await saveSettings(settingsDir, { ...(await loadSettings(settingsDir)), projectsDir: await makeTempDir() });
  const handlers = new Map<string, (e: unknown, ...a: any[]) => any>();
  const broadcasts: { channel: string; payload: any }[] = [];
  const deps: IpcDeps = {
    ipcMain: { handle: (channel, fn) => { handlers.set(channel, fn); } },
    pickDirectory: async () => game,
    settingsDir,
    holder: { svc: null },
    broadcast: (channel, payload) => { broadcasts.push({ channel, payload }); },
    createChat: () => null,
    claudePath: () => null,
    showItemInFolder: () => {},
    fontDirs: () => [fontDir],
    pickFontFile: async () => o.pickFont ?? null,
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
  return { invoke, sent, font, fontDir, rows };
}

test('폰트를 정하면 preview:changed 가 가고 preview.layout 이 배치를 준다', async () => {
  const { invoke, sent, font, rows } = await setup();
  const dialogue = rows.find((r) => r.source === 'やった！')!;
  const before = await invoke('preview:get');
  expect(before.settings.fontPath).toBeNull();
  expect(before.metrics.boxWidth).toBe(808);
  expect(before.detected.engine).toBe('MZ');
  expect(before.fontMissing).toBe(false);
  expect(before.context.actorNames[1]).toBe('リナ');
  expect(await invoke('preview:layout', dialogue.id)).toBeNull();

  const list = await invoke('fonts:list');
  expect(list.fonts.map((f: { displayName: string }) => f.displayName)).toEqual(['시험체']);
  await invoke('preview:setFont', font);
  const changed = sent('preview:changed').at(-1);
  expect(changed.settings).toMatchObject({ fontPath: font, fontName: '시험체' });
  const l = await invoke('preview:layout', dialogue.id, '가나다');
  expect(l.maxWidth).toBe(78);
  expect((await invoke('preview:layout', dialogue.id)).lines).toHaveLength(1);

  // The made-up translation drops the source's punctuation; only the window width is under test here.
  await invoke('glossary:setRules', { notationCheck: false });
  await invoke('unit:setTranslation', dialogue.id, '가'.repeat(30));
  expect((await invoke('unit:get', dialogue.id)).issues.map((i: { rule: string }) => i.rule)).toEqual(['line-width-px']);
  expect(await invoke('preview:countOverflow')).toMatchObject({ overflowing: 1, checked: 1 });

  await invoke('preview:setOverrides', { boxWidth: 1000 });
  expect(sent('preview:changed').at(-1).metrics.boxWidth).toBe(1000);
  expect(await invoke('preview:countOverflow')).toMatchObject({ overflowing: 0 });
});

test('fonts.bytes 는 목록에 있는 경로만 준다', async () => {
  const { invoke, font } = await setup();
  const other = await makeTestFont(await makeTempDir(), { name: 'Later', glyphs: { 가: 1000 } });
  await invoke('fonts:list');
  const bytes = await invoke('fonts:bytes', font);
  expect(bytes).toBeInstanceOf(Uint8Array);
  expect(bytes.length).toBeGreaterThan(100);
  await expect(invoke('fonts:bytes', other)).rejects.toThrow('목록에 없는 폰트입니다');
  await expect(invoke('fonts:bytes', 'C:/Windows/System32/config/SAM')).rejects.toThrow('목록에 없는 폰트입니다');
});

test('fonts.pickFile 이 고른 폰트를 user 로 더하고, 읽을 수 없으면 오류', async () => {
  const dir = await makeTempDir();
  const picked = await makeTestFont(dir, { name: 'Picked', glyphs: { 가: 1000 } });
  const a = await setup({ pickFont: picked });
  const info = await a.invoke('fonts:pickFile');
  expect(info).toMatchObject({ path: picked, family: 'Picked', source: 'user' });
  expect((await a.invoke('fonts:list')).fonts.some((f: { path: string }) => f.path === picked)).toBe(true);
  expect((await a.invoke('fonts:bytes', picked)).length).toBeGreaterThan(100);

  const broken = path.join(dir, 'broken.ttf');
  await writeFile(broken, 'x');
  const b = await setup({ pickFont: broken });
  await expect(b.invoke('fonts:pickFile')).rejects.toThrow('폰트 파일을 읽을 수 없습니다');
  const c = await setup({ pickFont: null });
  expect(await c.invoke('fonts:pickFile')).toBeNull();
});

test('preview.windowSkin: 암호화된 게임에서도 PNG 를 준다, 없으면 null', async () => {
  const enc = await setup({ encrypted: true, skin: true });
  const skin = await enc.invoke('preview:windowSkin');
  expect([...skin.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const plain = await setup({ skin: true });
  expect([...(await plain.invoke('preview:windowSkin')).slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  const none = await setup();
  expect(await none.invoke('preview:windowSkin')).toBeNull();
});

test('고른 폰트 파일이 사라지면 fontMissing 이고 앱이 죽지 않는다', async () => {
  const { invoke, font, rows } = await setup();
  await invoke('preview:setFont', font);
  const { rm } = await import('node:fs/promises');
  await rm(font);
  await invoke('project:close');
  const dir = (await invoke('project:list'))[0].dir;
  await invoke('project:open', dir);
  const p = await invoke('preview:get');
  expect(p.fontMissing).toBe(true);
  expect(await invoke('preview:layout', rows[0].id)).toBeNull();
});

test('창 넘침: 행 표시와 개수, 창별 기준, 다시 맞추기 계획과 실행, 다시 열어도 표시', async () => {
  const { invoke, sent, font, rows } = await setup();
  const dialogue = rows.find((r) => r.source === 'やった！')!;
  await invoke('glossary:setRules', { notationCheck: false });
  await invoke('preview:setFont', font);
  await invoke('preview:setWindow', 'message', { width: 26 * 4 });
  const state = sent('preview:changed').at(-1);
  expect(state.windows.message).toMatchObject({ limit: { width: 104 }, override: { width: 104 }, hangulWidth: 26 });
  expect(state.windows.help.limit.maxLines).toBe(2);

  await invoke('unit:setTranslation', dialogue.id, '가나다 가나다');
  const changed = sent('project:changed').at(-1);
  expect(changed.rows.find((r: Row) => r.id === dialogue.id).overflow).toBe(true);
  expect(changed.stats.overflow).toBe(1);
  expect((await invoke('unit:get', dialogue.id)).issues.map((i: { message: string }) => i.message)).toEqual(['1번째 줄이 대사창을 59px 넘어요']);

  expect(await invoke('project:rewrapPlan', { window: 'message' })).toMatchObject({ fixed: 1, unfixable: 0 });
  expect(await invoke('project:rewrapPlan', { window: 'help' })).toMatchObject({ fixed: 0 });
  expect(await invoke('project:rewrap', { ids: [dialogue.id] })).toMatchObject({ fixed: 1 });
  expect((await invoke('unit:get', dialogue.id)).row).toMatchObject({ target: '가나다\n가나다' });
  expect(sent('project:changed').at(-1).rows.find((r: Row) => r.id === dialogue.id).overflow).toBeUndefined();

  await invoke('unit:setTranslation', dialogue.id, '가나다가나다');
  await invoke('project:close');
  await invoke('project:open', (await invoke('project:list'))[0].dir);
  const snap = await invoke('project:snapshot');
  expect(snap.rows.find((r: Row) => r.id === dialogue.id).overflow).toBe(true);
  expect(snap.stats.overflow).toBe(1);
  await invoke('preview:setWindow', 'message', { width: null });
  expect((await invoke('preview:get')).windows.message.override).toEqual({});
});
