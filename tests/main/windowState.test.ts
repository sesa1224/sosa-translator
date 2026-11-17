import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { loadWindowState, placeWindow, WindowStateSaver, type Rect, type WindowState } from '../../src/main/windowState.js';

const wide: Rect = { x: 0, y: 0, width: 3440, height: 1392 };
const side: Rect = { x: 3440, y: 0, width: 1920, height: 1032 };
const small: Rect = { x: 0, y: 0, width: 1366, height: 728 };

test('처음 실행: 1600x1000 을 작업 영역 가운데에', () => {
  expect(placeWindow(null, [wide, side], wide)).toEqual({ x: 920, y: 196, width: 1600, height: 1000, maximized: false });
});

test('처음 실행, 작은 화면: 작업 영역의 90% 를 넘지 않는다', () => {
  expect(placeWindow(null, [small], small)).toEqual({ x: 68, y: 36, width: 1229, height: 655, maximized: false });
});

test('기억한 자리와 크기, 최대화 여부를 그대로', () => {
  const s: WindowState = { x: 3500, y: 10, width: 1650, height: 1000, maximized: true };
  expect(placeWindow(s, [wide, side], wide)).toEqual(s);
});

test('기억한 자리가 빠진 모니터에 있으면 보이는 화면 안으로', () => {
  const s: WindowState = { x: 3600, y: 50, width: 1650, height: 1000, maximized: false };
  expect(placeWindow(s, [wide], wide)).toEqual({ x: 3440 - 1650, y: 50, width: 1650, height: 1000, maximized: false });
});

test('타이틀바가 화면 위로 나가 있으면 끌 수 있게 내린다', () => {
  const s: WindowState = { x: 100, y: -300, width: 1650, height: 1000, maximized: false };
  expect(placeWindow(s, [wide], wide)).toMatchObject({ x: 100, y: 0 });
});

test('조금만 걸친 창(타이틀바가 거의 안 보임)은 안으로 당긴다', () => {
  const s: WindowState = { x: 3440 - 40, y: 100, width: 1200, height: 800, maximized: false };
  expect(placeWindow(s, [wide], wide)).toMatchObject({ x: 3440 - 1200, y: 100 });
});

test('두 화면에 걸쳐 둔 창은 그대로', () => {
  const s: WindowState = { x: 3000, y: 100, width: 1200, height: 800, maximized: false };
  expect(placeWindow(s, [wide, side], wide)).toEqual(s);
});

test('화면보다 큰 기억 크기는 화면에 맞춘다', () => {
  const s: WindowState = { x: 0, y: 0, width: 3440, height: 1392, maximized: false };
  expect(placeWindow(s, [small], small)).toEqual({ x: 0, y: 0, width: 1366, height: 728, maximized: false });
});

let dir = '';
afterEach(async () => { vi.useRealTimers(); if (dir) await rm(dir, { recursive: true, force: true }); dir = ''; });

test('읽기: 없거나 깨진 파일, 이상한 값은 null', async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'mvmz-ws-'));
  expect(await loadWindowState(dir)).toBeNull();
  await writeFile(path.join(dir, 'window.json'), '{broken', 'utf8');
  expect(await loadWindowState(dir)).toBeNull();
  await writeFile(path.join(dir, 'window.json'), JSON.stringify({ x: 1, y: 2, width: 'a', height: 3, maximized: false }), 'utf8');
  expect(await loadWindowState(dir)).toBeNull();
  await writeFile(path.join(dir, 'window.json'), JSON.stringify({ x: 1, y: 2, width: 1500, height: 900, maximized: true }), 'utf8');
  expect(await loadWindowState(dir)).toEqual({ x: 1, y: 2, width: 1500, height: 900, maximized: true });
});

test('저장: 크기를 바꾸는 동안은 모았다가 한 번, 닫을 때는 바로', async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'mvmz-ws-'));
  vi.useFakeTimers();
  const writes: WindowState[] = [];
  const saver = new WindowStateSaver(dir, 500, (s) => writes.push(s));
  for (let i = 0; i < 20; i++) { saver.update({ x: 0, y: 0, width: 1400 + i, height: 900, maximized: false }); vi.advanceTimersByTime(50); }
  expect(writes).toHaveLength(0);
  vi.advanceTimersByTime(500);
  expect(writes).toEqual([{ x: 0, y: 0, width: 1419, height: 900, maximized: false }]);
  saver.update({ x: 5, y: 5, width: 1500, height: 900, maximized: true });
  saver.flush();
  expect(writes).toHaveLength(2);
  vi.advanceTimersByTime(1000);
  expect(writes).toHaveLength(2);
  expect(JSON.parse(await readFile(path.join(dir, 'window.json'), 'utf8'))).toEqual({ x: 5, y: 5, width: 1500, height: 900, maximized: true });
});
