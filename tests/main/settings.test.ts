import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeEach, expect, test } from 'vitest';
import { loadSettings, saveSettings } from '../../src/main/settings.js';
import { DEFAULT_MODELS } from '../../src/shared/api.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';

let dir: string;
beforeEach(async () => { dir = await makeTempDir(); });
afterAll(async () => { await cleanupTempDirs(); });

test('설정 기본값과 깨진 파일', async () => {
  expect((await loadSettings(dir)).chatModel).toBe('claude-fable-5-2');
  await writeFile(path.join(dir, 'settings.json'), '{깨'); expect((await loadSettings(dir)).theme).toBe('dark');
  await expect(saveSettings(dir, { ...(await loadSettings(dir)), models: [] })).rejects.toThrow('모델이 하나 이상 있어야 합니다');
});

// Extra coverage beyond the plan's assertions.
test('저장하고 다시 읽기, 빠진 값은 기본값', async () => {
  const s = await loadSettings(dir);
  expect(s).toMatchObject({ theme: 'dark', models: DEFAULT_MODELS, claudePath: null });
  expect(s.projectsDir.endsWith('MVMZ 번역 작업실')).toBe(true);
  await saveSettings(dir, { ...s, theme: 'light', claudePath: 'C:/c.exe' });
  expect(await loadSettings(dir)).toEqual({ ...s, theme: 'light', claudePath: 'C:/c.exe' });
  await writeFile(path.join(dir, 'settings.json'), JSON.stringify({ projectsDir: 'D:/p' }));
  expect(await loadSettings(dir)).toEqual({ ...s, projectsDir: 'D:/p' });
});

test('넘긴 의견 줄 건너뛰기는 기본으로 켜져 있다', async () => {
  expect((await loadSettings(dir)).reviewSkipPassed).toBe(true);
  // An older settings file has no such field.
  await writeFile(path.join(dir, 'settings.json'), JSON.stringify({ theme: 'light' }));
  expect((await loadSettings(dir)).reviewSkipPassed).toBe(true);
  await saveSettings(dir, { ...(await loadSettings(dir)), reviewSkipPassed: false });
  expect((await loadSettings(dir)).reviewSkipPassed).toBe(false);
});
