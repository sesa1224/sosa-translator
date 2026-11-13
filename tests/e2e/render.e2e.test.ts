import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron, type ElectronApplication } from 'playwright-core';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { normalizeRegion } from '../../src/core/images/store.js';
import { MAX_CLAUDE_SIDE, sheetLayout } from '../../src/core/images/sheet.js';
import type { Region } from '../../src/core/images/types.js';
import { makePng, readPng } from '../helpers/png.js';
import { makeTestFont } from '../helpers/testFont.js';

let tmp: string, app: ElectronApplication, fontPath: string, fontB64: string;

beforeAll(async () => {
  tmp = await mkdtemp(path.join(os.tmpdir(), 'mvmz-render-'));
  await mkdir(path.join(tmp, 'userData'), { recursive: true });
  fontPath = await makeTestFont(tmp, { name: 'Render Font', glyphs: { 가: 1000, 나: 1000 } });
  fontB64 = (await readFile(fontPath)).toString('base64');
  app = await electron.launch({ args: ['.'], env: { ...process.env, MVMZ_USER_DATA: path.join(tmp, 'userData'), MVMZ_TEST_HOOKS: '1' } as Record<string, string> });
  await app.firstWindow();
});
afterAll(async () => {
  await app?.close();
  await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
const RED = makePng(100, 60, [255, 0, 0, 255]);

/** Runs RenderService.render in the app's main process. */
async function render(base: Uint8Array, regions: Region[], withFont = false): Promise<ReturnType<typeof readPng>> {
  const out = await app.evaluate(async (_e, a) => {
    const svc = (globalThis as any).__mvmzTest.render;
    const bytes = (s: string) => new Uint8Array(Buffer.from(s, 'base64'));
    const fonts: Record<string, Uint8Array> = {};
    for (const [k, v] of Object.entries(a.fonts as Record<string, string>)) fonts[k] = bytes(v);
    const png: Uint8Array = await svc.render({ base: bytes(a.base), regions: a.regions, fonts, defaultFontPath: a.defaultFontPath });
    return Buffer.from(png).toString('base64');
  }, { base: b64(base), regions, fonts: withFont ? { [fontPath]: fontB64 } : {}, defaultFontPath: withFont ? fontPath : null });
  return readPng(new Uint8Array(Buffer.from(out, 'base64')));
}

const IMG = { width: 100, height: 60 };
const rect = { x: 10, y: 10, w: 80, h: 40 };

test('색으로 채워 지우기', async () => {
  const png = await render(RED, [normalizeRegion({ rect, erase: 'fill', fillColor: '#0000ff', text: '' }, IMG)]);
  expect([png.width, png.height]).toEqual([100, 60]);
  expect(png.pixel(50, 30)).toEqual([0, 0, 255, 255]);
  expect(png.pixel(2, 2)).toEqual([255, 0, 0, 255]);
});

test('주변 색으로 채워 지우기', async () => {
  const base = makePng(100, 60, (x, y) => (x >= 10 && x < 90 && y >= 10 && y < 50 ? [0, 255, 0, 255] : [255, 0, 0, 255]));
  const png = await render(base, [normalizeRegion({ rect, erase: 'sample', text: '' }, IMG)]);
  expect(png.pixel(50, 30)).toEqual([255, 0, 0, 255]);
  expect(png.pixel(11, 11)).toEqual([255, 0, 0, 255]);
});

test('시험 폰트로 글을 찍는다: 가운데와 왼쪽 정렬', async () => {
  const center = await render(RED, [normalizeRegion({ rect, erase: 'none', text: '가', size: 40, color: '#ffffff' }, IMG)], true);
  expect(center.pixel(50, 30)).toEqual([255, 255, 255, 255]);
  expect(center.pixel(2, 2)).toEqual([255, 0, 0, 255]);
  const left = await render(RED, [normalizeRegion({ rect, erase: 'none', text: '가', size: 40, color: '#ffffff', align: 'left' }, IMG)], true);
  expect(left.pixel(25, 30)).toEqual([255, 255, 255, 255]);
  expect(left.pixel(87, 30)).toEqual([255, 0, 0, 255]);
});

test('폰트가 없으면 그 작업만 실패한다', async () => {
  await expect(render(RED, [normalizeRegion({ rect, text: '가' }, IMG)])).rejects.toThrow('그림을 찍지 못했습니다');
  const ok = await render(RED, [normalizeRegion({ rect, erase: 'fill', fillColor: '#00ff00', text: '' }, IMG)]);
  expect(ok.pixel(50, 30)).toEqual([0, 255, 0, 255]);
});

async function sheet(count: number, columns: number, cellSize: number) {
  const pngs = Array.from({ length: count }, (_, i) => b64(makePng(50 + i * 10, 30, [40 * i, 200, 100, 255])));
  const out = await app.evaluate(async (_e, a) => {
    const svc = (globalThis as any).__mvmzTest.render;
    const cells = a.pngs.map((p: string, i: number) => ({ label: `img/pictures/그림${i}.png`, png: new Uint8Array(Buffer.from(p, 'base64')) }));
    return Buffer.from(await svc.sheet({ cells, columns: a.columns, cellSize: a.cellSize })).toString('base64');
  }, { pngs, columns, cellSize });
  return readPng(new Uint8Array(Buffer.from(out, 'base64')));
}

test('모음판: 5장 3열은 가로 3칸 세로 2줄, 긴 변은 1,568 이하', async () => {
  const s = await sheet(5, 3, 200);
  const L = sheetLayout(5, 3, 200);
  expect([L.columns, L.rows]).toEqual([3, 2]);
  expect([s.width, s.height]).toEqual([L.outWidth, L.outHeight]);
  expect([s.width, s.height]).toEqual([600, L.height]);
  const big = await sheet(5, 3, 800);
  expect(Math.max(big.width, big.height)).toBeLessThanOrEqual(MAX_CLAUDE_SIDE);
  expect(big.width).toBe(MAX_CLAUDE_SIDE);
});

test('썸네일은 긴 변을 줄이고 작은 그림은 그대로', async () => {
  const thumb = async (png: Uint8Array, side: number) => readPng(new Uint8Array(Buffer.from(await app.evaluate(async (_e, a) => {
    const svc = (globalThis as any).__mvmzTest.render;
    return Buffer.from(await svc.thumbnail(new Uint8Array(Buffer.from(a.png, 'base64')), a.side)).toString('base64');
  }, { png: b64(png), side }), 'base64')));
  const t = await thumb(makePng(400, 100, [0, 0, 255, 255]), 256);
  expect([t.width, t.height]).toEqual([256, 64]);
  expect(t.pixel(100, 30)).toEqual([0, 0, 255, 255]);
  const same = await thumb(makePng(40, 10), 256);
  expect([same.width, same.height]).toEqual([40, 10]);
});

test('작업 창이 떠 있어도 본 창을 닫으면 앱이 끝난다', async () => {
  const closed = new Promise<void>((resolve) => app.process().once('exit', () => resolve()));
  const win = await app.firstWindow();
  await win.close();
  await Promise.race([closed, new Promise((_r, reject) => setTimeout(() => reject(new Error('앱이 끝나지 않았습니다')), 15000))]);
});
