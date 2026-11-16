import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { buildContext, layoutMessage } from '../../src/core/preview/layout.js';
import { DEFAULT_METRICS } from '../../src/core/preview/metrics.js';
import type { Measure, PreviewContext, Run } from '../../src/core/preview/types.js';
import { createProject } from '../../src/core/project/project.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';
import { makeMiniGame } from '../helpers/miniGame.js';

afterAll(cleanupTempDirs);

const MV = DEFAULT_METRICS.MV;
/** Each character is fontSize wide. */
const fake: Measure = (text, size) => ({ width: [...text].length * size, missing: 0 });
const ctx = (p: Partial<PreviewContext> = {}): PreviewContext => ({ actorNames: {}, variables: {}, currencyUnit: 'G', partyNames: {}, ...p });
const lay = (text: string, c: PreviewContext = ctx(), withFace = false, measure: Measure = fake) => layoutMessage(text, MV, measure, c, { withFace });
const texts = (runs: Run[]) => runs.map((r) => (r.type === 'text' ? r.text : `[icon${r.index}]`)).join('');

test('평범한 글', () => {
  const l = lay('가나다');
  expect(l.lines).toHaveLength(1);
  expect(l.lines[0].runs).toEqual([{ type: 'text', text: '가나다', color: 0, size: 28 }]);
  expect(l.lines[0].width).toBe(84);
  expect(l.lines[0].overflow).toBe(0);
  expect(l.available).toBe(780);
});

test('색 바꾸기', () => {
  const l = lay('\\C[2]빨강\\C[0]보통');
  expect(l.lines[0].runs).toEqual([
    { type: 'text', text: '빨강', color: 2, size: 28 },
    { type: 'text', text: '보통', color: 0, size: 28 },
  ]);
  expect(l.lines[0].width).toBe(112);
});

test('변수', () => {
  const l = lay('\\V[1]골드', ctx({ variables: { 1: '150' } }));
  expect(texts(l.lines[0].runs)).toBe('150골드');
  expect(l.lines[0].width).toBe(140);
  expect(texts(lay('\\V[1]골드').lines[0].runs)).toBe('0골드');
});

test('액터 이름, 파티, 화폐 단위 (대소문자 무시)', () => {
  expect(texts(lay('\\N[1]야!', ctx({ actorNames: { 1: '리나' } })).lines[0].runs)).toBe('리나야!');
  expect(texts(lay('\\n[1]야!', ctx({ actorNames: { 1: '리나' } })).lines[0].runs)).toBe('리나야!');
  expect(texts(lay('\\N[2]야!', ctx({ actorNames: { 1: '리나' } })).lines[0].runs)).toBe('야!');
  expect(texts(lay('\\P[1]와 100\\G', ctx({ partyNames: { 1: '리나' }, currencyUnit: '골드' })).lines[0].runs)).toBe('리나와 100골드');
});

test('아이콘', () => {
  const l = lay('\\I[5]검');
  expect(l.lines[0].runs).toEqual([{ type: 'icon', index: 5, size: 28 }, { type: 'text', text: '검', color: 0, size: 28 }]);
  expect(l.lines[0].width).toBe(36 + 28);
});

test('글자 크기', () => {
  const l = lay('\\{크게\\}보통');
  expect(l.lines[0].runs).toEqual([
    { type: 'text', text: '크게', color: 0, size: 40 },
    { type: 'text', text: '보통', color: 0, size: 28 },
  ]);
  expect(l.lines[0].width).toBe(80 + 56);
  const big = lay('\\{\\{\\{\\{\\{\\{가');
  expect(big.lines[0].runs[0]).toMatchObject({ size: 96 });
  const small = lay('\\}\\}\\}가');
  expect(small.lines[0].runs[0]).toMatchObject({ size: 24 });
  // MZ limits; the size carries over to the next line
  const mz = layoutMessage('\\{\\{\\{\\{\\{\\{\\{\\{\\{가\n나\\}\\}\\}\\}\\}\\}\\}\\}\\}\\}\\}다', DEFAULT_METRICS.MZ, fake, ctx(), { withFace: false });
  expect(mz.lines[0].runs[0]).toMatchObject({ size: 108 });
  expect(mz.lines[1].runs[0]).toMatchObject({ text: '나', size: 108 });
  expect(mz.lines[1].runs[1]).toMatchObject({ text: '다', size: 12 });
});

test('폭 0 제어문자와 역슬래시', () => {
  const l = lay('대기\\.\\|\\!끝');
  expect(l.lines[0].runs).toEqual([{ type: 'text', text: '대기끝', color: 0, size: 28 }]);
  expect(l.lines[0].width).toBe(84);
  expect(texts(lay('a\\>\\<\\^\\$\\FS[20]b\\\\c').lines[0].runs)).toBe('ab\\c');
});

test('바꾼 글 안의 제어문자는 풀지 않는다', () => {
  expect(texts(lay('\\V[1]', ctx({ variables: { 1: '\\C[2]' } })).lines[0].runs)).toBe('\\C[2]');
});

test('넘침', () => {
  const line = '가'.repeat(28);
  const l = lay(line);
  expect(l.lines[0].width).toBe(784);
  // MV message window: 816 - 18 * 2 = 780 (Window_Message draws from x 0 of its contents, no text padding).
  expect(l.lines[0].overflow).toBe(4);
  expect(l.maxWidth).toBe(784);
  expect(lay(line, ctx(), true).lines[0].overflow).toBe(172);
});

test('이름 칸 코드(\\n<이름>)는 폭을 차지하지 않는다', () => {
  expect(lay('\\n<리나>가나').lines[0].width).toBe(56);
  expect(lay('\\NC<리나 언니>가').lines[0].width).toBe(28);
  expect(lay('\\N[1]가', ctx({ actorNames: { 1: '리나' } })).lines[0].width).toBe(84);
});

test('width 를 주면 그 폭에서 얼굴만큼 뺀다', () => {
  expect(layoutMessage('가', MV, fake, ctx(), { withFace: false, width: 500 }).available).toBe(500);
  expect(layoutMessage('가', MV, fake, ctx(), { withFace: true, width: 500 }).available).toBe(332);
});

test('줄 수와 빈 줄', () => {
  expect(lay('1\n2\n3\n4\n5').lineOverflow).toBe(1);
  expect(lay('1\n2\n3\n4').lineOverflow).toBe(0);
  const l = lay('첫\n\n셋');
  expect(l.lines).toHaveLength(3);
  expect(l.lines[1]).toEqual({ runs: [], width: 0, overflow: 0 });
});

test('색은 다음 줄로 이어진다', () => {
  const l = lay('\\C[3]첫\n둘');
  expect(l.lines[1].runs[0]).toMatchObject({ color: 3, text: '둘' });
});

test('없는 글자 수', () => {
  const l = lay('가나', ctx(), false, (t, s) => ({ width: t.length * s, missing: 2 }));
  expect(l.missingGlyphs).toBe(2);
});

test('buildContext: 액터 이름(번역 우선), 화폐 단위, 파티', async () => {
  const game = await makeTempDir();
  await makeMiniGame(game);
  const sysFile = path.join(game, 'data', 'System.json');
  const sys = JSON.parse(await readFile(sysFile, 'utf8'));
  sys.partyMembers = [1];
  await writeFile(sysFile, JSON.stringify(sys), 'utf8');
  const proj = path.join(await makeTempDir(), 'proj');
  await createProject(game, proj, 'p');
  const known: Record<string, string> = { リナ: '리나', ゴールド: '골드' };
  const c = await buildContext(proj, (s) => known[s] ?? null);
  expect(c).toEqual({ actorNames: { 1: '리나' }, variables: {}, currencyUnit: '골드', partyNames: { 1: '리나' } });
  const raw = await buildContext(proj, () => null);
  expect(raw.actorNames[1]).toBe('リナ');
  expect(raw.currencyUnit).toBe('ゴールド');
});
