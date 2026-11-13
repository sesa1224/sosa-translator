import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { makeMiniGame } from '../helpers/miniGame.js';

const fakeClaude = path.resolve(__dirname, '../fixtures/fake-claude.mjs');
let tmp: string, userData: string, projectsDir: string, game: string;

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'mvmz-e2e-'));
  userData = path.join(tmp, 'userData');
  projectsDir = path.join(tmp, 'projects');
  game = path.join(tmp, 'game');
  await mkdir(userData, { recursive: true });
  await makeMiniGame(game);
  // Keep projects out of the real Documents folder.
  await writeFile(path.join(userData, 'settings.json'), JSON.stringify({ projectsDir }), 'utf8');
});
afterAll(async () => { await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });

function launch(env: Record<string, string> = {}): Promise<ElectronApplication> {
  return electron.launch({ args: ['.'], env: { ...process.env, MVMZ_USER_DATA: userData, ...env } as Record<string, string> });
}

test('앱이 뜨고 프로젝트 고르기 화면이 보인다', async () => {
  const app = await launch();
  const win = await app.firstWindow();
  expect(await win.title()).toBe('MV/MZ 번역 작업실');
  await expect(win.getByRole('heading', { name: '프로젝트' })).toBeVisible();
  expect(await win.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  await app.close();
});

test('가져오기 → 손으로 번역 → 채팅 → 빌드', async () => {
  const app = await launch({ MVMZ_PICK_DIR: game, MVMZ_CLAUDE_COMMAND: process.execPath, MVMZ_CLAUDE_PREFIX_ARGS: JSON.stringify([fakeClaude]) });
  const w = await app.firstWindow();
  await w.getByRole('button', { name: '게임 폴더 고르기' }).click(); await w.getByLabel('프로젝트 이름').fill('약초원'); await w.getByRole('button', { name: '만들기' }).click();
  await w.getByText('月光草', { exact: true }).click(); await w.getByLabel('번역').fill('월광초'); await w.getByLabel('번역').press('Control+Enter');
  await expect(w.getByRole('row', { name: /月光草.*월광초.*검토 필요/ })).toBeVisible();
  await w.getByRole('tab', { name: '채팅' }).click(); await w.getByLabel('메시지').fill('안녕'); await w.getByLabel('메시지').press('Enter');
  await expect(w.getByText('받음: 안녕')).toBeVisible();
  await w.getByRole('button', { name: '패치 빌드' }).click(); await expect(w.getByText(/패치를 만들었습니다 · 파일 1개/)).toBeVisible();
  expect(existsSync(path.join(projectsDir, '약초원/builds/001/약초원_patch_001.zip'))).toBe(true);
  await app.close();
});
