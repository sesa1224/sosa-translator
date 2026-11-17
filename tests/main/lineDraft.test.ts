import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import type { JsonCallResult } from '../../src/main/claude/json.js';
import { registerIpc, type IpcDeps } from '../../src/main/ipc.js';
import { loadSettings, saveSettings } from '../../src/main/settings.js';
import { buildTranslatePrompt, planBatches } from '../../src/main/translate/batches.js';
import type { LineDraft, Row } from '../../src/shared/api.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';
import { makeMiniGame } from '../helpers/miniGame.js';
import { okAll, someUsage, zero } from './jobHelpers.js';

afterAll(() => cleanupTempDirs());

const handlers = new Map<string, (e: unknown, ...a: any[]) => any>();
const invoke = async (channel: string, ...args: any[]): Promise<any> => handlers.get(channel)!({}, ...args);
type Call = (o: { model: string; system: string; user: string; schema: any; signal?: AbortSignal }) => Promise<JsonCallResult<any>>;
let answer: Call = okAll as Call;
const sentCalls: { model: string; system: string; user: string }[] = [];
let holder: IpcDeps['holder'];
let projDir = "";
let settingsDir = "";
let disposeIpc: (() => Promise<void>) | null = null;

const rows = async (): Promise<Row[]> => (await invoke('project:snapshot')).rows;
const idOf = async (source: string) => (await rows()).find((r) => r.source === source)!.id;
const translationsFile = () => readFile(path.join(projDir, 'translations.json'), 'utf8').catch(() => '');

beforeEach(async () => {
  handlers.clear();
  sentCalls.length = 0;
  answer = okAll as Call;
  const game = await makeTempDir();
  await makeMiniGame(game);
  settingsDir = await makeTempDir();
  const projectsDir = await makeTempDir();
  await saveSettings(settingsDir, { ...(await loadSettings(settingsDir)), projectsDir });
  holder = { svc: null };
  const deps: IpcDeps = {
    ipcMain: { handle: (channel, fn) => { handlers.set(channel, fn); } },
    pickDirectory: async () => game, settingsDir, holder,
    broadcast: () => {}, createChat: () => null, claudePath: () => 'C:/fake/claude.exe', showItemInFolder: () => {},
    runJson: (async (o: Parameters<Call>[0]) => { sentCalls.push({ model: o.model, system: o.system, user: o.user }); return answer(o); }) as any,
  };
  disposeIpc = registerIpc(deps).dispose;
  await invoke('project:create', game, '약초원');
  projDir = holder.svc!.projectDir;
});
afterEach(async () => { await disposeIpc?.(); });

test('Claude 초안: 한 줄을 번역시켜 돌려주고 번역표는 그대로 둔다', async () => {
  await invoke('glossary:confirm');
  const id = await idOf('夜に光る草。\\C[2]貴重\\C[0]だ');
  const before = await translationsFile();
  const d: LineDraft = await invoke('unit:claudeDraft', id);
  expect(d).toEqual({ text: '번역\\C[2]\\C[0]', usage: someUsage });
  expect(sentCalls).toHaveLength(1);
  expect(await translationsFile()).toBe(before);
  expect((await rows()).find((r) => r.id === id)!.target).toBeNull();
  expect(holder.svc!.entry(id).status).toBe('untranslated');
});

test('Claude 초안이 싣는 것은 번역 작업이 그 한 줄에 싣는 것과 같다', async () => {
  await invoke('glossary:confirm');
  const id = await idOf('やった！');
  await invoke('unit:claudeDraft', id);
  const s = holder.svc!;
  const [batch] = planBatches(s.units(), (x) => s.entry(x), s.glossary(), { ids: [id], includeStatuses: ['untranslated'], decisions: s.decisions() });
  const expected = buildTranslatePrompt(batch, s.glossary());
  expect(sentCalls[0].user).toBe(expected.user);
  expect(sentCalls[0].system).toBe(expected.system);
  const user = JSON.parse(sentCalls[0].user);
  expect(user.items).toHaveLength(1);
  expect(user.context.length).toBeLessThanOrEqual(3);
  expect(sentCalls[0].model).toBe((await loadSettings(settingsDir)).stageModels.translate);
});

test('Claude 초안: 이미 번역된 줄도 받을 수 있고 번역은 바뀌지 않는다', async () => {
  await invoke('glossary:confirm');
  const id = await idOf('月光草');
  await invoke('unit:setTranslation', id, '월광초');
  const d: LineDraft = await invoke('unit:claudeDraft', id);
  expect(d.text).toBe('번역');
  expect(holder.svc!.entry(id).target).toBe('월광초');
});

test('Claude 초안: 거절이나 실패는 이유와 쓴 토큰으로 돌아온다', async () => {
  await invoke('glossary:confirm');
  const id = await idOf('月光草');
  answer = async () => ({ ok: true, data: { items: [{ i: 0, t: null, declined: '못 하겠어요' }] }, usage: someUsage });
  expect(await invoke('unit:claudeDraft', id)).toEqual({ text: null, reason: '못 하겠어요', usage: someUsage });
  answer = async () => ({ ok: false, kind: 'other', message: '연결이 끊겼습니다', usage: zero });
  expect(await invoke('unit:claudeDraft', id)).toEqual({ text: null, reason: '연결이 끊겼습니다', usage: zero });
  expect(holder.svc!.entry(id).status).toBe('untranslated');
});

test('Claude 초안: 용어집 확정 전, 다른 작업 중에는 막히고, 초안을 받는 동안에는 다른 작업이 막힌다', async () => {
  const id = await idOf('月光草');
  await expect(invoke('unit:claudeDraft', id)).rejects.toThrow('용어집을 먼저 확정하세요');
  await invoke('glossary:confirm');

  // A translate job that waits on its call: the draft is refused while it runs.
  let release: () => void = () => undefined;
  answer = (o) => new Promise((resolve) => { release = () => resolve(okAll(o as any)); });
  await invoke('job:translate');
  await expect(invoke('unit:claudeDraft', id)).rejects.toThrow('다른 작업이 진행 중입니다');
  await invoke('job:stop');
  release();
  await new Promise((r) => setTimeout(r, 30));

  // A draft that waits on its call: jobs are refused until it answers.
  answer = (o) => new Promise((resolve) => { release = () => resolve(okAll(o as any)); });
  const pending = invoke('unit:claudeDraft', id);
  await new Promise((r) => setTimeout(r, 10));
  await expect(invoke('job:translate')).rejects.toThrow('다른 작업이 진행 중입니다');
  await expect(invoke('unit:claudeDraft', id)).rejects.toThrow('다른 작업이 진행 중입니다');
  release();
  expect((await pending).text).toBe('번역');
  answer = okAll as Call;
  await invoke('job:translate');
});

test('Claude 초안: 없는 줄과 판단 전의 줄은 받을 수 없다', async () => {
  await invoke('glossary:confirm');
  await expect(invoke('unit:claudeDraft', 'nope')).rejects.toThrow('없는 항목입니다: nope');
  const undecided = (await rows()).find((r) => r.needsDecision && r.decision !== 'translate');
  if (undecided) await expect(invoke('unit:claudeDraft', undecided.id)).rejects.toThrow('이 줄은 지금 번역할 수 없어요');
  expect(sentCalls).toHaveLength(0);
});
