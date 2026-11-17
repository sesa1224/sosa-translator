import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { registerIpc, type IpcDeps } from '../../src/main/ipc.js';
import { saveSettings, loadSettings } from '../../src/main/settings.js';
import type { Row } from '../../src/shared/api.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';
import { makeMiniGame, miniItems } from '../helpers/miniGame.js';

const handlers = new Map<string, (e: unknown, ...a: any[]) => any>();
const invoke = async (channel: string, ...args: any[]): Promise<any> => {
  const h = handlers.get(channel);
  if (!h) throw new Error(`no handler: ${channel}`);
  return h({}, ...args);
};

const GRASS = '夜に光る草。\\C[2]貴重\\C[0]だ';
const SEED = '夜に光る草の種。\\C[2]貴重\\C[0]だ';

beforeAll(async () => {
  const game = await makeTempDir();
  await makeMiniGame(game);
  writeFileSync(path.join(game, 'data', 'Items.json'), JSON.stringify([...miniItems(), { id: 2, name: '星の砂', description: SEED, note: '' }]));
  const settingsDir = await makeTempDir();
  await saveSettings(settingsDir, { ...(await loadSettings(settingsDir)), projectsDir: await makeTempDir() });
  const deps: IpcDeps = {
    ipcMain: { handle: (channel, fn) => { handlers.set(channel, fn); } },
    pickDirectory: async () => game,
    settingsDir,
    holder: { svc: null },
    broadcast: () => {},
    createChat: () => null,
    claudePath: () => null,
    showItemInFolder: () => {},
  };
  registerIpc(deps);
  await invoke('project:create', game, '약초원');
});
afterAll(async () => { await invoke('project:close'); await cleanupTempDirs(); });

test('similar:find 는 번역된 비슷한 문장을 위치와 함께 돌려준다', async () => {
  const rows: Row[] = (await invoke('project:snapshot')).rows;
  const grass = rows.find((r) => r.source === GRASS)!.id;
  const seed = rows.find((r) => r.source === SEED)!.id;
  expect(await invoke('similar:find', seed)).toEqual([]);
  await invoke('unit:setTranslation', grass, '밤에 빛나는 풀. \\C[2]귀하\\C[0]다');
  expect(await invoke('similar:find', seed)).toEqual([
    { id: grass, source: GRASS, target: '밤에 빛나는 풀. \\C[2]귀하\\C[0]다', score: 78, location: 'Items · 1' },
  ]);
  await expect(invoke('similar:find', 'nope')).rejects.toThrow('없는 항목입니다: nope');
});
