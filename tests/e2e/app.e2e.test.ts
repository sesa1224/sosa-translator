import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { makeMiniGame } from '../helpers/miniGame.js';
import { makeTestFont } from '../helpers/testFont.js';

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

test('게임 폰트 고르기 → 긴 번역 → 미리보기 넘침과 px 경고 → 스토리', async () => {
  const game3 = path.join(tmp, 'game3');
  await makeMiniGame(game3);
  const fontDir = path.join(tmp, 'fonts');
  await mkdir(fontDir, { recursive: true });
  const glyphs: Record<string, number> = { ' ': 250 };
  for (const ch of '가나다라마바사아자차카타파하좋아다음에힣뷁') glyphs[ch] = 1000;   // 가 힣 뷁: counts as a Hangul font
  await makeTestFont(fontDir, { name: 'E2E Font', nameKo: '시험 글꼴', glyphs });

  const app = await launch({ MVMZ_PICK_DIR: game3, MVMZ_FONT_DIRS: fontDir });
  const w = await app.firstWindow();
  const nav = w.getByRole('navigation', { name: '작업 메뉴' });
  await w.getByRole('button', { name: '게임 폴더 고르기' }).click(); await w.getByLabel('프로젝트 이름').fill('미리보기'); await w.getByRole('button', { name: '만들기' }).click();

  await nav.getByRole('button', { name: /^설정/ }).click();
  const fonts = w.getByRole('listbox', { name: '폰트 목록' });
  await fonts.getByRole('option', { name: /시험 글꼴/ }).click();
  await expect(fonts.getByRole('option', { name: /시험 글꼴/, selected: true })).toBeVisible();
  await expect(w.getByText(/지금 폰트: 시험 글꼴/)).toBeVisible();

  await nav.getByRole('button', { name: /^텍스트/ }).click();
  await w.getByText('やった！', { exact: true }).click();
  await w.getByLabel('번역').fill('가'.repeat(40));
  await w.getByLabel('번역').press('Control+Enter');
  // MZ window, no face: 768 px; 40 characters at 26 px = 1040 px.
  await expect(w.getByText('1040 / 768px')).toBeVisible();
  await expect(w.getByTestId('overflow-mark')).toBeVisible();
  await expect(w.getByText('1번째 줄이 창을 272px 넘어요')).toBeVisible();
  await expect(w.getByText('프로그램이 흉내 내어 그린 화면이에요. 실제 확인은 게임에서 해요.')).toBeVisible();

  await w.getByRole('button', { name: '스토리' }).click();
  await expect(w.getByText('왼쪽에서 범위를 고르면 장면이 나와요')).toBeVisible();
  await nav.getByRole('button', { name: /^맵1/ }).click();
  await expect(w.getByRole('region', { name: '맵1 · 이벤트1' })).toBeVisible();
  const choices = w.getByRole('group', { name: '선택지' });
  await expect(choices.getByText('いいよ')).toBeVisible();
  await expect(choices.getByText('また今度')).toBeVisible();
  await app.close();
});
