import { rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, expect, test } from 'vitest';
import { checkTranslation } from '../../src/core/check/format.js';
import { layoutMessage } from '../../src/core/preview/layout.js';
import { DEFAULT_METRICS } from '../../src/core/preview/metrics.js';
import type { TextUnit } from '../../src/core/types.js';
import { faceMap, PreviewService } from '../../src/main/preview.js';
import { ProjectService } from '../../src/main/projectService.js';
import type { ChangeEvent } from '../../src/shared/api.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';
import { makeMiniGame } from '../helpers/miniGame.js';
import { makeTestFont } from '../helpers/testFont.js';
import { idFinder } from './helpers.js';

afterAll(cleanupTempDirs);

const open: ProjectService[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

/** Each Hangul test character is `em` font units wide (1000 = one em). */
async function font(dir: string, name: string, em: number): Promise<string> {
  const glyphs: Record<string, number> = { ' ': 250, A: 600 };
  for (const ch of '가나다라마바사아자차카타파하월광초줄래보답으로골드') glyphs[ch] = em;
  return makeTestFont(dir, { name, glyphs });
}

type Cmd = { code: number; indent: number; parameters: unknown[] };
const say = (face: string, ...lines: string[]): Cmd[] => [
  { code: 101, indent: 0, parameters: [face, 0, 0, 2, ''] },
  ...lines.map((l) => ({ code: 401, indent: 0, parameters: [l] })),
];
const END: Cmd = { code: 0, indent: 0, parameters: [] };

/** Mini game whose Map001 holds the given event pages (each a command list). */
async function gameWith(pages: Cmd[][]): Promise<{ game: string; proj: string }> {
  const game = await makeTempDir();
  await makeMiniGame(game);
  const map = JSON.parse(await readFile(path.join(game, 'data', 'Map001.json'), 'utf8'));
  map.events = [null, ...pages.map((list, i) => ({ id: i + 1, name: `EV${i + 1}`, pages: [{ list: [...list, END] }] }))];
  await writeFile(path.join(game, 'data', 'Map001.json'), JSON.stringify(map), 'utf8');
  return { game, proj: path.join(await makeTempDir(), 'proj') };
}

async function start(pages: Cmd[][]) {
  const { game, proj } = await gameWith(pages);
  const svc = await ProjectService.create(game, proj, 'p');
  open.push(svc);
  const preview = new PreviewService(svc);
  await preview.init();
  return { svc, preview, proj, idOf: idFinder(() => svc.units()) };
}

// MZ defaults: font size 26, 768 px without a face, 604 px with one.
const LONG = '가'.repeat(30);    // 780 px at 1 em: over 768
const MID = '가'.repeat(24);     // 624 px: fits without a face, over 604 with one

test('checkTranslation: px 가 있으면 가장 많이 넘친 줄 하나만, 글자 수 검사는 하지 않는다', () => {
  const unit: TextUnit = { id: 'u', kind: 'dialogue', source: 'あ\nい', needsDecision: false, refs: [] };
  const measure = (t: string, s: number) => ({ width: [...t].length * s, missing: 0 });
  const layout = (text: string, withFace: boolean) => layoutMessage(text, DEFAULT_METRICS.MZ, measure, { actorNames: {}, variables: {}, currencyUnit: '', partyNames: {} }, { withFace });
  const glossary = { terms: [], maxLineWidthChars: 5 };
  const issues = checkTranslation(unit, `${'가'.repeat(30)}\n${'가'.repeat(31)}`, undefined, glossary, { layout, withFace: false });
  expect(issues).toEqual([{ rule: 'line-width-px', severity: 'warning', message: '2번째 줄이 창을 38px 넘어요' }]);
  // Without px the character count rule still runs.
  expect(checkTranslation(unit, `${'가'.repeat(6)}\n가`, undefined, glossary).map((i) => i.rule)).toEqual(['line-width']);
  // Only dialogue is checked by width.
  expect(checkTranslation({ ...unit, kind: 'choice' }, '가'.repeat(40), undefined, undefined, { layout, withFace: false })).toEqual([]);
});

test('폰트가 없으면 layoutFor 는 null, 검사는 글자 수 방식', async () => {
  const { svc, preview, idOf } = await start([say('', 'ながい')]);
  await svc.setRules({ maxLineWidthChars: 10 });
  expect(preview.layoutFor(idOf('ながい'))).toBeNull();
  expect(preview.settings()).toEqual({ fontPath: null, fontName: null, overrides: {} });
  const issues = await svc.setTranslation(idOf('ながい'), LONG, 'user');
  expect(issues.map((i) => i.rule)).toEqual(['line-width']);
});

test('폰트를 정하면 창을 넘는 번역에 line-width-px 경고, 상태는 needs-review', async () => {
  const { svc, preview, idOf } = await start([say('', 'ながい')]);
  const f = await font(await makeTempDir(), 'Wide', 1000);
  const seen: ChangeEvent[] = [];
  await svc.setTranslation(idOf('ながい'), '가가', 'user');
  svc.on('changed', (e) => seen.push(e));
  await preview.setFont(f);
  expect(preview.settings().fontPath).toBe(f);
  expect(seen.some((e) => e.ids.includes(idOf('ながい')))).toBe(true);   // warnings may change: rows are announced
  const issues = await svc.setTranslation(idOf('ながい'), LONG, 'user');
  expect(issues).toEqual([{ rule: 'line-width-px', severity: 'warning', message: '1번째 줄이 창을 12px 넘어요' }]);
  expect(svc.issues(idOf('ながい'))).toEqual(issues);
  expect(svc.entry(idOf('ながい')).status).toBe('needs-review');
  const l = preview.layoutFor(idOf('ながい'))!;
  expect(l.maxWidth).toBe(780);
  expect(l.available).toBe(768);
  expect(preview.layoutFor(idOf('ながい'), '가가')!.maxWidth).toBe(52);
});

test('layoutFor: 번역이 없으면 원문, 값이 없는 변수는 123', async () => {
  const { svc, preview, idOf } = await start([say('', 'ながい'), say('', 'あ\\V[3]')]);
  await preview.setFont(await font(await makeTempDir(), 'W', 1000));
  // The test font has no kana: each is one em wide and missing.
  expect(preview.layoutFor(idOf('ながい'))!.missingGlyphs).toBe(3);
  await svc.setTranslation(idOf('あ\\V[3]'), '가\\V[3]', 'user');
  const l = preview.layoutFor(idOf('あ\\V[3]'))!;
  expect(l.lines[0].runs).toEqual([{ type: 'text', text: '가123', color: 0, size: 26 }]);
});

test('얼굴 그림이 있는 대사는 더 일찍 넘치고, 같은 문장이 양쪽에 있으면 얼굴 있는 쪽으로', async () => {
  const { svc, preview, idOf, proj } = await start([say('Actor1', 'かお'), say('', 'なし'), say('', 'りょうほう'), say('Actor1', 'りょうほう')]);
  await preview.setFont(await font(await makeTempDir(), 'W', 1000));
  expect(await svc.setTranslation(idOf('なし'), MID, 'user')).toEqual([]);
  expect((await svc.setTranslation(idOf('かお'), MID, 'user')).map((i) => i.message)).toEqual(['1번째 줄이 창을 20px 넘어요']);
  expect((await svc.setTranslation(idOf('りょうほう'), MID, 'user')).map((i) => i.rule)).toEqual(['line-width-px']);
  expect(preview.layoutFor(idOf('りょうほう'))!.available).toBe(604);
  const faces = await faceMap(proj, svc.units());
  expect(faces[idOf('かお')]).toBe(true);
  expect(faces[idOf('なし')]).toBe(false);
  expect(faces[idOf('りょうほう')]).toBe(true);
});

test('countOverflow: 넘치는 항목 수, 다른 폰트로 재 봐도 설정은 그대로', async () => {
  const { svc, preview, idOf } = await start([say('', 'いち'), say('', 'に'), say('', 'さん')]);
  const dir = await makeTempDir();
  const normal = await font(dir, 'Normal', 1000);
  const wide = await font(dir, 'Wider', 1300);
  await preview.setFont(normal);
  await svc.setTranslation(idOf('いち'), LONG, 'user');      // 780: over
  await svc.setTranslation(idOf('に'), MID, 'user');         // 624: fits; 811 with the wider font
  await svc.setTranslation(idOf('さん'), '가가', 'user');     // fits in both
  expect(await preview.countOverflow()).toEqual({ overflowing: 1, checked: 3, missingGlyphs: 0 });
  expect((await preview.countOverflow(wide)).overflowing).toBe(2);
  expect(preview.settings().fontPath).toBe(normal);
  expect((await preview.countOverflow(null)).overflowing).toBe(1);
});

test('7,000개 대사의 넘침 세기가 1초 안에 끝난다', async () => {
  const pages: Cmd[][] = [];
  const list: Cmd[] = [];
  for (let i = 0; i < 7000; i++) list.push(...say(i % 3 === 0 ? 'Actor1' : '', `台詞${i}`, `二行目${i}`));
  pages.push(list);
  const { game, proj } = await gameWith(pages);
  const first = await ProjectService.create(game, proj, 'p');
  const table: Record<string, unknown> = {};
  const chars = '가나다라마바사아자차카타파하';
  first.units().filter((u) => u.kind === 'dialogue').forEach((u, i) => {
    const line = Array.from({ length: 10 + (i % 25) }, (_, k) => chars[(i + k) % chars.length]).join('');
    table[u.id] = { target: `${line}\n${line.slice(3)}`, status: 'needs-review', updatedAt: '2026-11-13T00:00:00.000Z' };
  });
  await first.close();
  await writeFile(path.join(proj, 'translations.json'), JSON.stringify(table), 'utf8');
  const svc = await ProjectService.open(proj);
  open.push(svc);
  const preview = new PreviewService(svc);
  await preview.init();
  const dir = await makeTempDir();
  await preview.setFont(await font(dir, 'Normal', 1000));
  const wide = await font(dir, 'Wide', 1100);
  const t0 = performance.now();
  const r = await preview.countOverflow();
  const t1 = performance.now();
  const r2 = await preview.countOverflow(wide);
  const t2 = performance.now();
  expect(r.checked).toBe(7000);
  expect(r.overflowing).toBeGreaterThan(0);
  expect(r2.overflowing).toBeGreaterThan(r.overflowing);
  expect(t1 - t0).toBeLessThan(1000);
  expect(t2 - t1).toBeLessThan(1000);
});

test('폰트 파일이 사라지면 fontMissing, 검사는 글자 수 방식으로, 예외 없음', async () => {
  const { svc, preview, idOf } = await start([say('', 'ながい')]);
  await svc.setRules({ maxLineWidthChars: 10 });
  const dir = await makeTempDir();
  const f = await font(dir, 'Gone', 1000);
  await preview.setFont(f);
  expect(preview.fontMissing).toBe(false);
  await rm(f);
  const again = new PreviewService(svc);
  await again.init();
  expect(again.fontMissing).toBe(true);
  expect(again.settings().fontPath).toBe(f);
  expect(again.layoutFor(idOf('ながい'))).toBeNull();
  expect((await svc.setTranslation(idOf('ながい'), LONG, 'user')).map((i) => i.rule)).toEqual(['line-width']);
  expect(await again.countOverflow()).toEqual({ overflowing: 0, checked: 0, missingGlyphs: 0 });
});

test('치수 고치기가 검사에 반영되고 되돌릴 수 있다', async () => {
  const { svc, preview, idOf } = await start([say('', 'ながい')]);
  await preview.setFont(await font(await makeTempDir(), 'W', 1000));
  await svc.setTranslation(idOf('ながい'), MID, 'user');
  expect(svc.issues(idOf('ながい'))).toEqual([]);
  await preview.setOverrides({ boxWidth: 600 });
  expect(preview.metrics().boxWidth).toBe(600);
  expect(svc.issues(idOf('ながい')).map((i) => i.rule)).toEqual(['line-width-px']);
  await preview.setOverrides({});
  expect(preview.metrics().boxWidth).toBe(808);
  expect(svc.issues(idOf('ながい'))).toEqual([]);
});
