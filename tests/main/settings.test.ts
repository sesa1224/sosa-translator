import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeEach, expect, test } from 'vitest';
import { loadSettings, saveSettings } from '../../src/main/settings.js';
import { DEFAULT_MODELS, THEME_NAMES } from '../../src/shared/api.js';
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

test('테마는 여덟 가지, 모르는 값은 어두운으로 읽는다', async () => {
  for (const theme of THEME_NAMES) {
    await writeFile(path.join(dir, 'settings.json'), JSON.stringify({ theme }));
    expect((await loadSettings(dir)).theme).toBe(theme);
  }
  expect(THEME_NAMES).toEqual(['dark', 'light', 'moon', 'ember', 'murim', 'deep', 'rpg', 'hanji']);
  for (const theme of ['neon', 3, null]) {
    await writeFile(path.join(dir, 'settings.json'), JSON.stringify({ theme }));
    expect((await loadSettings(dir)).theme).toBe('dark');
  }
});

test('움직임은 기본으로 켜져 있고, 끈 것을 다시 읽는다', async () => {
  expect((await loadSettings(dir)).motion).toBe(true);
  // An older settings file has no such field; a broken value falls back too.
  await writeFile(path.join(dir, 'settings.json'), JSON.stringify({ theme: 'light', motion: 'no' }));
  expect((await loadSettings(dir)).motion).toBe(true);
  await saveSettings(dir, { ...(await loadSettings(dir)), motion: false });
  expect((await loadSettings(dir)).motion).toBe(false);
});

test('오른쪽 패널을 접은 것은 창 폭 구간마다 다시 읽고, 깨진 값은 버린다', async () => {
  expect((await loadSettings(dir)).rightPanelCollapsed).toBeUndefined();
  await saveSettings(dir, { ...(await loadSettings(dir)), rightPanelCollapsed: { narrow: false, wide: true } });
  expect((await loadSettings(dir)).rightPanelCollapsed).toEqual({ narrow: false, wide: true });
  await writeFile(path.join(dir, 'settings.json'), JSON.stringify({ rightPanelCollapsed: { narrow: 'yes', wide: true, other: false } }));
  expect((await loadSettings(dir)).rightPanelCollapsed).toEqual({ wide: true });
  await writeFile(path.join(dir, 'settings.json'), JSON.stringify({ rightPanelCollapsed: 3 }));
  expect((await loadSettings(dir)).rightPanelCollapsed).toBeUndefined();
});
