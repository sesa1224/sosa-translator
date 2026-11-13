import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { eventFiles, listEvents, readEvent } from '../../src/core/events/browse.js';
import { findUsage } from '../../src/core/events/usage.js';
import { listHash } from '../../src/core/patches/hash.js';
import { buildScenes } from '../../src/main/story.js';
import type { TextUnit } from '../../src/core/types.js';
import { cleanupTempDirs } from '../helpers/fs.js';
import { setupProject } from '../helpers/project.js';

afterAll(cleanupTempDirs);

let proj: string;
let units: TextUnit[];
const data = () => path.join(proj, 'original', 'v1', 'data');
const readData = async (name: string) => JSON.parse(await readFile(path.join(data(), name), 'utf8'));
const writeData = (name: string, v: unknown) => writeFile(path.join(data(), name), JSON.stringify(v));

beforeAll(async () => {
  ({ proj, units } = await setupProject());
  const map = await readData('Map001.json');
  const list = map.events[1].pages[0].list;
  list.splice(list.length - 1, 0,
    { code: 121, indent: 0, parameters: [45, 45, 0] },
    { code: 122, indent: 0, parameters: [12, 12, 1, 0, 1] },
    { code: 122, indent: 0, parameters: [5, 5, 0, 1, 12] },
    { code: 231, indent: 0, parameters: [1, '立ち絵', 0, 0, 0, 0, 100, 100, 255, 0] });
  map.events[1].pages[0].conditions = { switch1Valid: true, switch1Id: 3, variableValid: true, variableId: 12, variableValue: 2 };
  map.events.push({ id: 2, name: 'EV002', pages: [{ conditions: { switch1Valid: true, switch1Id: 45 }, list: [{ code: 0, indent: 0, parameters: [] }] }, { list: [] }] });
  map.events.push(null);
  await writeData('Map001.json', map);
  const ce = await readData('CommonEvents.json');
  ce[1].list.unshift({ code: 111, indent: 0, parameters: [0, 45, 0] });
  ce.push({ id: 2, name: '빈 것', list: [] });
  await writeData('CommonEvents.json', ce);
  const sys = await readData('System.json');
  sys.switches = ['', '', '', '문 열림'];
  sys.switches[45] = '기록1 완료';
  sys.variables = [];
  sys.variables[12] = '시간대';
  await writeData('System.json', sys);
});

test('스위치 45 를 쓰는 곳 3개', async () => {
  const r = await findUsage(proj, { type: 'switch', id: 45 });
  expect(r.map((x) => x.access)).toEqual(['write', 'read', 'read']);
  expect(r.map((x) => x.label)).toEqual(['맵1 · 이벤트1 · 1페이지', '맵1 · 이벤트2 · 1페이지', '커먼이벤트1']);
  expect(r[0]).toMatchObject({ file: 'data/Map001.json', listPath: ['events', 1, 'pages', 0, 'list'], index: 12, text: '스위치 45 [기록1 완료] = 켬' });
  expect(r[2]).toMatchObject({ file: 'data/CommonEvents.json', listPath: [1, 'list'], index: 0, text: '만약 스위치 45 [기록1 완료] 이 켜짐이면' });
  expect(r[1]).toMatchObject({ index: -1, text: '페이지 조건', listPath: ['events', 2, 'pages', 0, 'list'] });
});

test('변수: 대입은 write, 값으로 쓰면 read', async () => {
  const r = await findUsage(proj, { type: 'variable', id: 12 });
  expect(r.map((x) => [x.index, x.access])).toEqual([[-1, 'read'], [13, 'write'], [14, 'read']]);
});

test('그림 파일 이름으로 231 을 찾는다', async () => {
  const r = await findUsage(proj, { type: 'picture', id: '立ち絵' });
  expect(r).toHaveLength(1);
  expect(r[0].text).toBe('그림 표시 1번: 立ち絵');
});

test('listEvents 는 페이지마다 한 줄, readEvent 의 해시는 listHash(raw)', async () => {
  const evs = await listEvents(proj, 'data/Map001.json');
  expect(evs.map((e) => e.label)).toEqual(['이벤트 1 · 1페이지', '이벤트 2 · 1페이지', '이벤트 2 · 2페이지']);
  expect(evs[0]).toMatchObject({ pages: 1, condition: '스위치 3 [문 열림] 켜짐 · 변수 12 [시간대] ≥ 2', commandCount: 17 });
  expect(evs[1].listPath).toEqual(['events', 2, 'pages', 0, 'list']);
  const ev = await readEvent(proj, 'data/Map001.json', evs[0].listPath);
  expect(ev.hash).toBe(listHash(ev.raw));
  expect(ev.label).toBe('맵1 · 이벤트1 · 1페이지');
  expect(ev.lines[0].text).toContain('대사 [リナ]');
  const ce = await listEvents(proj, 'data/CommonEvents.json');
  expect(ce.map((e) => e.label)).toEqual(['커먼이벤트 1', '커먼이벤트 2 [빈 것]']);
});

test('페이지 조건의 글이 이야기 화면(story.ts)과 같다', async () => {
  const scenes = await buildScenes(proj, units, 'data/Map001.json', null);
  const evs = await listEvents(proj, 'data/Map001.json');
  expect(scenes[0].condition).not.toBeNull();
  expect(evs[0].condition).toBe(scenes[0].condition);
});

test('eventFiles 와 null 이벤트, 빈 목록에서 예외가 없다', async () => {
  const files = await eventFiles(proj);
  expect(files).toEqual([
    { file: 'data/Map001.json', label: '맵1 [MAP001]', events: 2 },
    { file: 'data/CommonEvents.json', label: '커먼이벤트', events: 2 },
  ]);
  const empty = await readEvent(proj, 'data/Map001.json', ['events', 2, 'pages', 1, 'list']);
  expect(empty.lines).toEqual([]);
  await expect(readEvent(proj, 'data/Map001.json', ['events', 3, 'pages', 0, 'list'])).rejects.toThrow();
  expect(await findUsage(proj, { type: 'item', id: 99 })).toEqual([]);
  expect(await findUsage(proj, { type: 'commonEvent', id: 1 })).toEqual([]);
});
