import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { makeMiniGame } from '../helpers/miniGame.js';
import { strFromU8, unzipSync } from 'fflate';
import { MENU_PLUGIN_JS } from '../helpers/miniGame.js';

const fakeClaude = path.resolve(__dirname, '../fixtures/fake-claude.mjs');
const fakeClaudeJson = path.resolve(__dirname, '../fixtures/fake-claude-json.mjs');
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

test('용어집 초안 → 확정 → 전체 번역 → 검수 → 빌드', async () => {
  // The mini game plus an MV-style message whose first line is the speaker.
  const game2 = path.join(tmp, 'game2');
  await makeMiniGame(game2);
  const mapFile = path.join(game2, 'data', 'Map001.json');
  const map = JSON.parse(await readFile(mapFile, 'utf8'));
  const list: unknown[] = map.events[1].pages[0].list;
  list.splice(list.length - 1, 0, { code: 101, indent: 0, parameters: ['', 0, 0, 2, ''] },
    { code: 401, indent: 0, parameters: ['【アーテル】'] }, { code: 401, indent: 0, parameters: ['「え？」'] });
  await writeFile(mapFile, JSON.stringify(map), 'utf8');

  const app = await launch({ MVMZ_PICK_DIR: game2, MVMZ_CLAUDE_JSON_COMMAND: process.execPath, MVMZ_CLAUDE_JSON_PREFIX_ARGS: JSON.stringify([fakeClaudeJson]) });
  const w = await app.firstWindow();
  const nav = w.getByRole('navigation', { name: '작업 메뉴' });
  await w.getByRole('button', { name: '게임 폴더 고르기' }).click(); await w.getByLabel('프로젝트 이름').fill('한 바퀴'); await w.getByRole('button', { name: '만들기' }).click();
  await nav.getByRole('button', { name: /^용어집/ }).click();
  await w.getByRole('button', { name: '초안 받기' }).click();
  await expect(w.getByText(/조각 \d+개 · 약/)).toBeVisible();
  await w.getByRole('button', { name: '시작' }).click();
  await expect(w.getByText('을 어떻게 옮길까요?')).toBeVisible();
  await w.getByRole('button', { name: /^린/ }).click();
  await expect(w.getByText(/リナ → 린/)).toBeVisible();
  await w.getByRole('button', { name: '용어집 확정' }).click();
  await expect(w.getByRole('button', { name: /확정됨/ })).toBeVisible();

  await nav.getByRole('button', { name: /^텍스트/ }).click();
  await w.getByRole('button', { name: /새 문장 \d+개 번역 맡기기/ }).click();
  await expect(w.getByText(/끝났어요 · \d+개 번역/)).toBeVisible();
  await expect(w.getByRole('row', { name: /【アーテル】.*【아텔】/ })).toBeVisible();

  await w.getByRole('button', { name: '번역 전체 검수' }).click();
  await w.getByRole('button', { name: '검수 시작' }).click();
  await expect(w.getByText(/검수 끝났어요/)).toBeVisible();
  await w.getByText('月光草', { exact: true }).click();
  await expect(w.getByText('용어가 어색함')).toBeVisible();
  await w.getByRole('button', { name: '고친 안 받기' }).click();
  await expect(w.getByRole('row', { name: /月光草.*월광초\(검수\)/ })).toBeVisible();

  await w.getByRole('button', { name: '패치 빌드' }).click(); await expect(w.getByText(/패치를 만들었습니다/)).toBeVisible();
  expect(existsSync(path.join(projectsDir, '한 바퀴/builds/001/한 바퀴_patch_001.zip'))).toBe(true);
  await app.close();
});

test('판단 필요: 추천 받기 → 받아들이기 → 번역 → 제목 → 빌드', async () => {
  const game3 = path.join(tmp, 'game3');
  await makeMiniGame(game3, { decisions: true });
  const app = await launch({ MVMZ_PICK_DIR: game3, MVMZ_CLAUDE_JSON_COMMAND: process.execPath, MVMZ_CLAUDE_JSON_PREFIX_ARGS: JSON.stringify([fakeClaudeJson]) });
  const w = await app.firstWindow();
  const nav = w.getByRole('navigation', { name: '작업 메뉴' });
  await w.getByRole('button', { name: '게임 폴더 고르기' }).click(); await w.getByLabel('프로젝트 이름').fill('판단'); await w.getByRole('button', { name: '만들기' }).click();

  await nav.getByRole('button', { name: /^판단 필요/ }).click();
  await expect(w.getByRole('heading', { name: '판단 필요' })).toBeVisible();
  await w.getByRole('button', { name: 'Claude에게 추천 받기' }).click();
  await expect(w.getByText(/판단 필요 추천을 받았어요/)).toBeVisible();
  // The picture argument is decided by the plugin's header, without a call.
  await expect(w.getByText(/추천: 번역 안 함 — 플러그인이 이 값을 file 로 선언함/)).toBeVisible();
  await w.getByRole('button', { name: /추천 전부 받아들이기/ }).click();
  await expect(w.getByRole('button', { name: /^정할 것 0/ })).toBeVisible();

  await nav.getByRole('button', { name: /^용어집/ }).click();
  await w.getByRole('button', { name: '용어집 확정' }).click();
  await expect(w.getByRole('button', { name: /확정됨/ })).toBeVisible();
  await nav.getByRole('button', { name: /^텍스트/ }).click();
  await w.getByRole('button', { name: /새 문장 \d+개 번역 맡기기/ }).click();
  await expect(w.getByText(/끝났어요 · \d+개 번역/)).toBeVisible();
  // The command name was kept, only the rest translated.
  await expect(w.getByRole('row', { name: /ShowRecord 記録.*ShowRecord 번역/ })).toBeVisible();

  await w.getByRole('button', { name: '게임 제목 고치기' }).click();
  await w.getByLabel('번역 제목').fill('안개 약초원'); await w.getByLabel('번역 제목').press('Enter');
  await expect(w.getByRole('banner').getByText('안개 약초원')).toBeVisible();

  await w.getByRole('button', { name: '패치 빌드' }).click(); await expect(w.getByText(/패치를 만들었습니다/)).toBeVisible();
  const zip = unzipSync(new Uint8Array(await readFile(path.join(projectsDir, '판단/builds/001/판단_patch_001.zip'))));
  expect(Object.keys(zip)).toEqual(expect.arrayContaining(['index.html', 'package.json', 'js/plugins/Menu.js', 'data/Items.json', 'data/Map001.json']));
  expect(strFromU8(zip['index.html'])).toContain('<title>안개 약초원</title>');
  expect(JSON.parse(strFromU8(zip['package.json']))).toMatchObject({ name: 'kiri-no-yakusouen', window: { title: '안개 약초원' } });
  // Only the string literal changed in the plugin file.
  expect(strFromU8(zip['js/plugins/Menu.js'])).toBe(MENU_PLUGIN_JS.replace('"記録を見る"', '"번역"'));
  expect(JSON.parse(strFromU8(zip['data/Items.json']))[1].note).toBe('<SG説明:번역>\n<price:100>');
  const list = JSON.parse(strFromU8(zip['data/Map001.json'])).events[1].pages[0].list;
  const cmds = list.filter((c: { code: number }) => c.code === 357).map((c: { parameters: unknown[] }) => c.parameters[3]);
  expect(cmds).toEqual([{ destination: '번역' }, { picture: '立ち絵' }]);
  await app.close();
});
