// Closing the window must end every process of the app: a leftover one keeps the exe locked, so the
// folder cannot be deleted or replaced by a new version.
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { makeMiniGame } from '../helpers/miniGame.js';
import { makePng } from '../helpers/png.js';

let tmp: string, userData: string, game: string;

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'mvmz-quit-'));
  userData = path.join(tmp, 'userData');
  game = path.join(tmp, 'game');
  await mkdir(userData, { recursive: true });
  await makeMiniGame(game);
  await writeFile(path.join(game, 'img', 'pictures', 'menu.png'), makePng(40, 20, [255, 0, 0, 255]));
  await writeFile(path.join(userData, 'settings.json'), JSON.stringify({ projectsDir: path.join(tmp, 'projects') }), 'utf8');
});
afterAll(async () => { await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });

function exited(proc: { exitCode: number | null; once(e: 'exit', l: () => void): unknown }, ms: number): Promise<boolean> {
  if (proc.exitCode !== null) return Promise.resolve(true);
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(false), ms);
    proc.once('exit', () => { clearTimeout(t); resolve(true); });
  });
}

test('프로젝트를 열고 그림까지 본 뒤 창을 닫으면 앱이 완전히 꺼진다', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MVMZ_USER_DATA: userData, MVMZ_PICK_DIR: game } as Record<string, string> });
  const proc = app.process();
  const w = await app.firstWindow();
  await w.getByRole('button', { name: '게임 폴더 고르기' }).click(); await w.getByLabel('프로젝트 이름').fill('약초원'); await w.getByRole('button', { name: '만들기' }).click();
  await w.getByText('月光草', { exact: true }).click();
  // The picture list draws thumbnails in the hidden worker window.
  await w.getByRole('navigation', { name: '작업 메뉴' }).getByRole('button', { name: /^이미지/ }).click();
  await expect(w.getByRole('list', { name: '그림 목록' }).getByRole('button').first()).toBeVisible();
  await w.waitForTimeout(1500);
  await w.close();
  const done = await exited(proc, 15000);
  if (!done) proc.kill();
  expect(done).toBe(true);
});
