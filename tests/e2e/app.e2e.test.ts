import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { makeMiniGame } from '../helpers/miniGame.js';
import { makeTestFont } from '../helpers/testFont.js';
import { strFromU8, unzipSync } from 'fflate';
import { MENU_PLUGIN_JS } from '../helpers/miniGame.js';
import { makePng, readPng } from '../helpers/png.js';

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
  await expect(w.getByRole('row', { name: /月光草.*월광초.*번역 완료/ })).toBeVisible();
  await w.getByRole('tab', { name: '채팅' }).click(); await w.getByLabel('메시지').fill('안녕'); await w.getByLabel('메시지').press('Enter');
  await expect(w.getByText('받음: 안녕')).toBeVisible();
  await w.getByRole('button', { name: '패치 빌드' }).click(); await expect(w.getByText(/패치를 만들었습니다 · 파일 3개/)).toBeVisible();
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
  await w.getByRole('button', { name: '고친 안 받기', exact: true }).click();   // "모두 고친 안 받기" stands above the table
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

test('판단 필요: 추천 받기 → 받아들이기 → 번역 → 제목 → 빌드', async () => {
  const game4 = path.join(tmp, 'game4');
  await makeMiniGame(game4, { decisions: true });
  const app = await launch({ MVMZ_PICK_DIR: game4, MVMZ_CLAUDE_JSON_COMMAND: process.execPath, MVMZ_CLAUDE_JSON_PREFIX_ARGS: JSON.stringify([fakeClaudeJson]) });
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

test('이벤트: 줄 끼워 넣기 → 수정 내역 → 빌드 → 게임 실행', async () => {
  const game5 = path.join(tmp, 'game5');
  await makeMiniGame(game5);
  await writeFile(path.join(game5, 'Game.exe'), 'not a real exe');
  const app = await launch({ MVMZ_PICK_DIR: game5, MVMZ_GAME_SPAWN_FAKE: '1' });
  const w = await app.firstWindow();
  const nav = w.getByRole('navigation', { name: '작업 메뉴' });
  await w.getByRole('button', { name: '게임 폴더 고르기' }).click(); await w.getByLabel('프로젝트 이름').fill('이벤트'); await w.getByRole('button', { name: '만들기' }).click();

  await nav.getByRole('button', { name: /^이벤트/ }).click();
  await expect(w.getByRole('heading', { name: '이벤트' })).toBeVisible();
  await w.getByRole('button', { name: /맵1 \[MAP001\] · 이벤트 1개/ }).click();
  await w.getByRole('button', { name: /^이벤트 1 · 1페이지/ }).click();
  await expect(w.getByText(/あれ？.*こんな夜に来るなんて/)).toBeVisible();
  await expect(w.locator('[data-line="11"]')).toBeVisible();
  await w.locator('[data-line="11"]').hover();
  await w.locator('[data-line="11"]').getByRole('button', { name: '이 줄 아래에 끼워 넣기' }).click();
  await w.getByLabel('끼워 넣을 것').selectOption('switch-on');
  await w.getByLabel('스위치 번호').fill('45');
  await w.getByLabel('수정 제목').fill('기록 스위치 켜기');
  await w.getByRole('button', { name: '수정으로 기록' }).click();
  await expect(w.getByText('+ 스위치 45 = 켬')).toBeVisible();

  await nav.getByRole('button', { name: /^수정 내역/ }).click();
  await expect(w.getByRole('heading', { name: '수정 내역' })).toBeVisible();
  await expect(w.getByText('적용됨')).toBeVisible();

  await w.getByRole('button', { name: '패치 빌드' }).click(); await expect(w.getByText(/패치를 만들었습니다/)).toBeVisible();
  const zip = unzipSync(new Uint8Array(await readFile(path.join(projectsDir, '이벤트/builds/001/이벤트_patch_001.zip'))));
  const list = JSON.parse(strFromU8(zip['data/Map001.json'])).events[1].pages[0].list;
  expect(list[12]).toEqual({ code: 121, indent: 0, parameters: [45, 45, 0] });

  await w.getByRole('button', { name: '게임 실행' }).click();
  await expect(w.getByText('게임 실행 중')).toBeVisible();
  const copied = JSON.parse(await readFile(path.join(projectsDir, '이벤트/testplay/data/Map001.json'), 'utf8')).events[1].pages[0].list;
  expect(copied[12]).toEqual({ code: 121, indent: 0, parameters: [45, 45, 0] });
  expect(existsSync(path.join(projectsDir, '이벤트/testplay/Game.exe'))).toBe(true);
  // The original game folder is untouched.
  expect(JSON.parse(await readFile(path.join(game5, 'data/Map001.json'), 'utf8')).events[1].pages[0].list).toHaveLength(13);
  await w.getByRole('button', { name: '끝내기' }).click();
  await expect(w.getByRole('button', { name: '게임 실행' })).toBeVisible();
  await app.close();
});

// ---- one picture by hand, then a build with notes ----
test('이미지: 영역 만들기 → 문장 → 기본 폰트 → 끝남 → 빌드에 그림과 패치노트', async () => {
  const game7 = path.join(tmp, 'game7');
  await makeMiniGame(game7);
  const menuPng = makePng(200, 80, [30, 40, 90, 255]);
  await writeFile(path.join(game7, 'img', 'pictures', 'menu.png'), menuPng);
  const fontDir7 = path.join(tmp, 'fonts7');
  await mkdir(fontDir7, { recursive: true });
  const glyphs: Record<string, number> = { ' ': 250 };
  for (const ch of '이야기가힣뷁') glyphs[ch] = 1000;
  await makeTestFont(fontDir7, { name: 'E7 Font', nameKo: '그림 글꼴', glyphs });

  const app = await launch({ MVMZ_PICK_DIR: game7, MVMZ_FONT_DIRS: fontDir7 });
  const w = await app.firstWindow();
  const nav = w.getByRole('navigation', { name: '작업 메뉴' });
  await w.getByRole('button', { name: '게임 폴더 고르기' }).click(); await w.getByLabel('프로젝트 이름').fill('그림'); await w.getByRole('button', { name: '만들기' }).click();

  await nav.getByRole('button', { name: /^이미지/ }).click();
  await expect(w.getByRole('heading', { name: '이미지' })).toBeVisible();
  await w.getByRole('list', { name: '그림 목록' }).getByRole('button', { name: /menu\.png/ }).click();
  await expect(w.getByRole('img', { name: '원본' })).toBeVisible();

  // Default picture font first, so the finished recipe has a font.
  await w.getByRole('button', { name: '바꾸기' }).click();
  await w.getByRole('dialog', { name: '기본 이미지 폰트' }).getByRole('option', { name: /그림 글꼴/ }).click();
  await expect(w.getByText(/기본 이미지 폰트: 그림 글꼴/)).toBeVisible();

  const ov = w.getByLabel('원본 위에서 끌어 영역 만들기');
  const box = (await ov.boundingBox())!;
  await w.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.2);
  await w.mouse.down();
  await w.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5, { steps: 4 });
  await w.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.8, { steps: 4 });
  await w.mouse.up();
  await expect(w.getByText('선택한 글자 영역 1 / 1')).toBeVisible();
  await w.getByLabel('문장').fill('이야기');
  await w.getByLabel('지우기 방식').selectOption('fill');
  await expect(w.getByRole('img', { name: '번역본' })).toBeVisible();
  await w.getByRole('button', { name: '끝남으로 표시' }).click();
  await expect(w.getByRole('button', { name: '다시 할 것으로' })).toBeVisible();

  await w.getByRole('button', { name: '패치 빌드' }).click();
  await expect(w.getByText(/패치를 만들었습니다/)).toBeVisible();
  const zip = unzipSync(new Uint8Array(await readFile(path.join(projectsDir, '그림/builds/001/그림_patch_001.zip'))));
  expect(Object.keys(zip)).toEqual(expect.arrayContaining(['img/pictures/menu.png', '패치노트.txt', '설치 방법.txt']));
  expect(Buffer.from(zip['img/pictures/menu.png']).equals(Buffer.from(menuPng))).toBe(false);
  const out = readPng(zip['img/pictures/menu.png']);
  expect([out.width, out.height]).toEqual([200, 80]);
  expect(strFromU8(zip['패치노트.txt'])).toContain('그림 한국어 패치 빌드 1');

  await w.getByRole('button', { name: '패치노트 보기' }).click();
  await expect(w.getByRole('heading', { name: '빌드 기록' })).toBeVisible();
  await expect(w.getByText(/^빌드 1 · /)).toBeVisible();
  await app.close();
});

// ---- a new version of the game ----
test('게임 업데이트: 번역과 수정 → 빌드 → 새 버전 가져오기 → 결과 → 빌드 → 되돌리기', async () => {
  const game8 = path.join(tmp, 'game8');
  const game9 = path.join(tmp, 'game9');
  await makeMiniGame(game8);
  await makeMiniGame(game9, { variant: 'v2' });
  const app = await launch({ MVMZ_PICK_DIR: game8, MVMZ_PICK_DIR2: game9 });
  const w = await app.firstWindow();
  const nav = w.getByRole('navigation', { name: '작업 메뉴' });
  await w.getByRole('button', { name: '게임 폴더 고르기' }).click(); await w.getByLabel('프로젝트 이름').fill('업데이트'); await w.getByRole('button', { name: '만들기' }).click();

  // Two lines by hand.
  await w.getByText('いいよ', { exact: true }).first().click(); await w.getByLabel('번역').fill('좋아'); await w.getByLabel('번역').press('Control+Enter');
  await expect(w.getByRole('row', { name: /いいよ.*좋아/ })).toBeVisible();
  await w.getByText('やった！', { exact: true }).click(); await w.getByLabel('번역').fill('해냈다!'); await w.getByLabel('번역').press('Control+Enter');
  await expect(w.getByRole('row', { name: /やった！.*해냈다!/ })).toBeVisible();

  // A line put in at the end of the map event.
  await nav.getByRole('button', { name: /^이벤트/ }).click();
  await w.getByRole('button', { name: /맵1 \[MAP001\] · 이벤트 1개/ }).click();
  await w.getByRole('button', { name: /^이벤트 1 · 1페이지/ }).click();
  await w.locator('[data-line="11"]').hover();
  await w.locator('[data-line="11"]').getByRole('button', { name: '이 줄 아래에 끼워 넣기' }).click();
  await w.getByLabel('끼워 넣을 것').selectOption('switch-on');
  await w.getByLabel('스위치 번호').fill('45');
  await w.getByLabel('수정 제목').fill('기록 스위치 켜기');
  await w.getByRole('button', { name: '수정으로 기록' }).click();
  await expect(w.getByText('+ 스위치 45 = 켬')).toBeVisible();
  await w.getByRole('button', { name: '패치 빌드' }).click(); await expect(w.getByText(/패치를 만들었습니다/)).toBeVisible();

  // The new version.
  await w.getByRole('button', { name: '새 버전 가져오기' }).click();
  const dialog = w.getByRole('dialog', { name: '새 버전 가져오기' });
  await dialog.getByRole('button', { name: '폴더 고르기' }).click();
  await expect(dialog.getByLabel('버전 이름')).toBeVisible();
  expect(await dialog.getByLabel('버전 이름').inputValue()).toBe('1.1');
  await dialog.getByRole('button', { name: '가져오기' }).click();
  await expect(w.getByRole('heading', { name: 'v1 → 1.1' })).toBeVisible();
  await expect(w.getByText('바뀐 문장 3개 · 이전 번역을 참고로 붙였어요')).toBeVisible();
  await expect(w.getByText('새 문장 2개')).toBeVisible();
  await expect(w.getByText('사라진 문장 1개 · 번역 0개는 보관했어요')).toBeVisible();
  await expect(w.getByText('수정: 그대로 0 · 자리를 옮김 1 · 충돌 0')).toBeVisible();

  await w.getByRole('button', { name: '바뀐 문장 보기' }).click();
  await w.getByText('やった！！', { exact: true }).click();
  const prevBox = w.getByRole('region', { name: '이전 버전의 문장' });
  await expect(prevBox).toBeVisible();
  await expect(prevBox.getByText('해냈다!', { exact: true })).toBeVisible();

  await nav.getByRole('button', { name: /^수정 내역/ }).click();
  await expect(w.getByText('적용됨')).toBeVisible();

  await w.getByRole('button', { name: '패치 빌드' }).click(); await expect(w.getByText(/패치를 만들었습니다/)).toBeVisible();
  const zip = unzipSync(new Uint8Array(await readFile(path.join(projectsDir, '업데이트/builds/002/업데이트_patch_002.zip'))));
  const list = JSON.parse(strFromU8(zip['data/Map001.json'])).events[1].pages[0].list;
  expect(list[0]).toEqual({ code: 230, indent: 0, parameters: [30] });
  expect(list[13]).toEqual({ code: 121, indent: 0, parameters: [45, 45, 0] });
  expect(list.some((c: { code: number; parameters: unknown[] }) => c.code === 401 && c.parameters[0] === '해냈다!')).toBe(true);
  expect(list.some((c: { code: number; parameters: unknown[] }) => c.code === 102 && JSON.stringify(c.parameters[0]).includes('좋아'))).toBe(true);
  expect(strFromU8(zip['패치노트.txt'])).toContain('게임 1.1 에 맞춤');

  // Back to v1.
  await nav.getByRole('button', { name: '업데이트 결과' }).click();
  await w.getByRole('button', { name: '이 업데이트 되돌리기' }).click();
  await w.getByRole('alertdialog').getByRole('button', { name: '되돌리기' }).click();
  await expect(w.getByRole('heading', { name: '텍스트' })).toBeVisible();
  await expect(w.getByText('やった！', { exact: true })).toBeVisible();
  expect(await w.getByText('やった！！', { exact: true }).count()).toBe(0);
  await expect(w.getByText('むかしむかし', { exact: true })).toBeVisible();
  // The original game folders are untouched.
  expect(JSON.parse(await readFile(path.join(game8, 'data/Map001.json'), 'utf8')).events[1].pages[0].list).toHaveLength(13);
  expect(JSON.parse(await readFile(path.join(game9, 'data/Map001.json'), 'utf8')).events[1].pages[0].list).toHaveLength(14);
  await app.close();
});
