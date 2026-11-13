import path from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { listHash } from '../../src/core/patches/hash.js';
import type { EventCommand } from '../../src/core/patches/types.js';
import { registerIpc, type IpcDeps } from '../../src/main/ipc.js';
import { saveSettings, loadSettings } from '../../src/main/settings.js';
import { callTool, TOOL_DEFS } from '../../src/main/toolHandlers.js';
import { CHAT_TOOLS } from '../../src/main/claude/args.js';
import { buildSystemPrompt } from '../../src/main/claude/prompt.js';
import { computeStats } from '../../src/shared/rows.js';
import type { Row } from '../../src/shared/api.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';
import { makeMiniGame, miniMap } from '../helpers/miniGame.js';
import { parseLoggedIn } from '../../src/main/claude/auth.js';

const handlers = new Map<string, (e: unknown, ...a: any[]) => any>();
const broadcasts: { channel: string; payload: any }[] = [];
let v1: string;
let v2: string;
let deps: IpcDeps;
const LIST_PATH = ['events', 1, 'pages', 0, 'list'];

const invoke = async (channel: string, ...args: any[]): Promise<any> => {
  const h = handlers.get(channel);
  if (!h) throw new Error(`no handler: ${channel}`);
  return h({}, ...args);
};
const sent = (channel: string) => broadcasts.filter((b) => b.channel === channel).map((b) => b.payload);

beforeAll(async () => {
  v1 = await makeTempDir();
  v2 = await makeTempDir();
  await makeMiniGame(v1);
  await makeMiniGame(v2, { variant: 'v2' });
  const settingsDir = await makeTempDir();
  const projectsDir = await makeTempDir();
  await saveSettings(settingsDir, { ...(await loadSettings(settingsDir)), projectsDir });
  deps = {
    ipcMain: { handle: (channel, fn) => { handlers.set(channel, fn); } },
    pickDirectory: async () => v1,
    pickNewVersionDir: async () => v2,
    settingsDir,
    holder: { svc: null },
    broadcast: (channel, payload) => { broadcasts.push({ channel, payload }); },
    createChat: () => null,
    claudePath: () => null,
    showItemInFolder: () => {},
  };
  registerIpc(deps);
  await invoke('project:create', v1, '약초원');
});
afterAll(async () => { await invoke('project:close'); await cleanupTempDirs(); });

test('가져오기 전: 요약이 없고 채팅 도구도 없다고 답한다', async () => {
  expect(await invoke('update:summary')).toBeNull();
  expect(await invoke('update:versions')).toEqual([expect.objectContaining({ id: 'v1', label: 'v1' })]);
  expect(await callTool(deps.holder.svc!, 'update_summary', {})).toEqual({ ok: false, error: '가져온 업데이트가 없습니다' });
  expect(await invoke('update:pickGameDir')).toBe(v2);
  expect(await invoke('update:inspect', v2)).toMatchObject({ ok: true, sameGame: true, suggestedLabel: '1.1' });
});

test('가져오면 새 스냅숏이 오고, 되돌리면 전과 같다', async () => {
  const svc = deps.holder.svc!;
  const yatta = svc.units().find((u) => u.source === 'やった！')!.id;
  await invoke('unit:setTranslation', yatta, '해냈다!');
  // A patch deleting the line that changes in v2: it cannot be moved.
  const list = miniMap('MZ').events[1]!.pages[0].list as EventCommand[];
  await invoke('patches:add', { title: '대사 지우기', body: { kind: 'event', file: 'data/Map001.json', listPath: LIST_PATH, baseHash: listHash(list), ops: [{ op: 'delete', at: 6 }] } });
  const before = await invoke('project:snapshot');

  const summary = await invoke('update:import', v2, '1.1');
  expect(summary).toMatchObject({ to: 'v2', toLabel: '1.1' });
  const reloaded = sent('project:reloaded');
  expect(reloaded).toHaveLength(1);
  expect(reloaded[0].meta.current).toBe('v2');
  expect(reloaded[0].rows.some((r: Row) => r.source === '星の砂')).toBe(true);
  expect(reloaded[0].rows.find((r: Row) => r.source === 'やった！！')).toMatchObject({ target: '해냈다!', carried: true, previous: { source: 'やった！', target: '해냈다!' } });
  expect(await invoke('project:snapshot')).toEqual(reloaded[0]);
  expect(await invoke('update:summary')).toEqual(summary);
  expect((await invoke('update:versions')).map((v: { label: string }) => v.label)).toEqual(['v1', '1.1']);

  // The older version's event can still be read (the conflict needs it).
  const old = await invoke('events:read', 'data/Map001.json', LIST_PATH, 'v1');
  expect(old.raw[0].code).toBe(101);
  const now = await invoke('events:read', 'data/Map001.json', LIST_PATH);
  expect(now.raw[0].code).toBe(230);

  const tool = (await callTool(deps.holder.svc!, 'update_summary', {})) as any;
  expect(tool.ok).toBe(true);
  expect(tool.data.conflicts).toEqual([expect.objectContaining({ title: '대사 지우기', file: 'data/Map001.json', listPath: LIST_PATH, reason: expect.stringContaining('수정이 가리키던 줄이 새 버전에 없어요') })]);
  const read = (await callTool(deps.holder.svc!, 'event_read', { file: 'data/Map001.json', listPath: LIST_PATH, version: 'v1' })) as any;
  expect(read.data.lines[0].text).toContain('あれ？');

  await invoke('update:rollback');
  expect(sent('project:reloaded')).toHaveLength(2);
  expect(await invoke('project:snapshot')).toEqual(before);
});

test('채팅 도구 목록과 시스템 프롬프트', () => {
  expect(CHAT_TOOLS).toContain('update_summary');
  expect(TOOL_DEFS.map((t) => t.name)).toContain('update_summary');
  const p = buildSystemPrompt(deps.holder.svc!.meta, computeStats([]));
  expect(p).toContain('게임이 업데이트된 뒤 충돌난 수정은 update_summary 로 목록을 보고, event_read 로 옛 버전(version)과 지금 버전을 각각 읽어 같은 뜻의 수정을 지금 버전의 번호로 다시 낸다(event_patch). 원래 수정의 의도를 바꾸지 않는다.');
  expect(path.isAbsolute(v2)).toBe(true);
});

// ---- Claude CLI status ----

test('claude auth status 의 JSON 에서 loggedIn 을 읽는다', () => {
  expect(parseLoggedIn('{\n  "loggedIn": true,\n  "authMethod": "claude.ai"\n}\n')).toBe(true);
  expect(parseLoggedIn('{"loggedIn": false}')).toBe(false);
  expect(parseLoggedIn('Not logged in')).toBeNull();
  expect(parseLoggedIn('')).toBeNull();
});

test('app:claudeStatus: CLI 가 없으면 found false, 있으면 로그인 상태', async () => {
  deps.claudeLoggedIn = async () => false;
  deps.claudePath = () => null;
  expect(await invoke('app:claudeStatus')).toEqual({ found: false, path: null, loggedIn: null });
  deps.claudePath = () => 'C:/fake/claude.exe';
  expect(await invoke('app:claudeStatus')).toEqual({ found: true, path: 'C:/fake/claude.exe', loggedIn: false });
  deps.claudeLoggedIn = async () => true;
  expect(await invoke('app:claudeStatus')).toMatchObject({ loggedIn: true });
});
