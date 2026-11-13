import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { afterAll, beforeAll, expect, test } from 'vitest';

let tmp: string;
beforeAll(async () => { tmp = await mkdtemp(path.join(os.tmpdir(), 'mvmz-e2e-')); });
afterAll(async () => { await rm(tmp, { recursive: true, force: true }); });

test('앱이 뜨고 프로젝트 고르기 화면이 보인다', async () => {
  const app = await electron.launch({ args: ['.'], env: { ...process.env, MVMZ_USER_DATA: tmp } });
  const win = await app.firstWindow();
  expect(await win.title()).toBe('MV/MZ 번역 작업실');
  await expect(win.getByRole('heading', { name: '프로젝트' })).toBeVisible();
  expect(await win.evaluate(() => document.documentElement.dataset.theme)).toBe('dark');
  await app.close();
});
