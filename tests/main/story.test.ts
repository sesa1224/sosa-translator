import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { createProject } from '../../src/core/project/project.js';
import { extractAll } from '../../src/core/extract/index.js';
import { buildScenes } from '../../src/main/story.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';
import { makeMiniGame } from '../helpers/miniGame.js';

afterAll(cleanupTempDirs);

type Json = any;
async function project(edit: (files: { map: Json; system: Json; common: Json; items: Json }) => void = () => {}) {
  const game = await makeTempDir();
  await makeMiniGame(game);
  const read = async (n: string) => JSON.parse(await readFile(path.join(game, 'data', n), 'utf8'));
  const files = { map: await read('Map001.json'), system: await read('System.json'), common: await read('CommonEvents.json'), items: await read('Items.json') };
  edit(files);
  await writeFile(path.join(game, 'data', 'Map001.json'), JSON.stringify(files.map), 'utf8');
  await writeFile(path.join(game, 'data', 'System.json'), JSON.stringify(files.system), 'utf8');
  await writeFile(path.join(game, 'data', 'CommonEvents.json'), JSON.stringify(files.common), 'utf8');
  await writeFile(path.join(game, 'data', 'Items.json'), JSON.stringify(files.items), 'utf8');
  const proj = path.join(await makeTempDir(), 'proj');
  await createProject(game, proj, 'p');
  const { units } = await extractAll(proj);
  const src = (id: string) => units.find((u) => u.id === id)!.source;
  return { proj, units, src };
}

test('맵의 장면 하나: 대사, 선택지 둘(같은 묶음), 대사', async () => {
  const { proj, units, src } = await project();
  const scenes = await buildScenes(proj, units, 'data/Map001.json', null);
  expect(scenes).toHaveLength(1);
  const s = scenes[0];
  expect(s.label).toBe('맵1 · 이벤트1');
  expect(s.file).toBe('data/Map001.json');
  expect(s.condition).toBeNull();
  expect(s.lines.map((l) => [l.kind, src(l.id)])).toEqual([
    ['dialogue', 'あれ？\\N[1]じゃない！\nこんな夜に来るなんて'],
    ['choice', 'いいよ'],
    ['choice', 'また今度'],
    ['dialogue', 'やった！'],
  ]);
  expect(s.lines[1].choiceGroup).toBeDefined();
  expect(s.lines[1].choiceGroup).toBe(s.lines[2].choiceGroup);
  expect(s.lines[0].choiceGroup).toBeUndefined();
  expect(s.lines[0].speaker).toBe('リナ');
  expect(s.lines.map((l) => l.order)).toEqual([...s.lines.map((l) => l.order)].sort((a, b) => a - b));
});

test('페이지 조건을 글로: 스위치, 그리고 둘이면 · 로 잇는다', async () => {
  const one = await project(({ map, system }) => {
    map.events[1].pages[0].conditions = { switch1Valid: true, switch1Id: 12 };
    system.switches = [];
    system.switches[12] = '森の入口到着';
  });
  expect((await buildScenes(one.proj, one.units, 'data/Map001.json', null))[0].condition).toBe('스위치 12 [森の入口到着] 켜짐');

  const two = await project(({ map, system, items }) => {
    map.events[1].pages[0].conditions = {
      switch1Valid: true, switch1Id: 12, variableValid: true, variableId: 5, variableValue: 3,
      selfSwitchValid: true, selfSwitchCh: 'A', itemValid: true, itemId: 1, actorValid: true, actorId: 1,
    };
    system.switches = [];
    system.switches[12] = '森の入口到着';
    system.variables = [];
    system.variables[5] = '好感度';
    items[1].name = '月光草';
  });
  expect((await buildScenes(two.proj, two.units, 'data/Map001.json', null))[0].condition)
    .toBe('스위치 12 [森の入口到着] 켜짐 · 변수 5 [好感度] ≥ 3 · 셀프 스위치 A 켜짐 · 아이템 [月光草] 가짐 · 액터 [リナ] 있음');
});

test('같은 문장이 여러 페이지에 쓰이면 장면마다 나오고, 페이지 라벨이 붙는다', async () => {
  const { proj, units, src } = await project(({ map }) => {
    map.events[1].pages.push({ list: [
      { code: 101, indent: 0, parameters: ['', 0, 0, 2, 'リナ'] },
      { code: 401, indent: 0, parameters: ['やった！'] },
      { code: 0, indent: 0, parameters: [] },
    ] });
  });
  const scenes = await buildScenes(proj, units, 'data/Map001.json', null);
  expect(scenes.map((s) => s.label)).toEqual(['맵1 · 이벤트1', '맵1 · 이벤트1 · 2페이지']);
  expect(scenes[1].lines.map((l) => src(l.id))).toEqual(['やった！']);
  expect(scenes[0].lines.some((l) => l.id === scenes[1].lines[0].id)).toBe(true);
  expect(new Set(scenes.map((s) => s.key)).size).toBe(2);
});

test('커먼이벤트: 자동 실행 조건과 화자 줄 패턴', async () => {
  const { proj, units } = await project(({ common, system }) => {
    common[1].trigger = 2;
    common[1].switchId = 7;
    common[1].list = [
      { code: 101, indent: 0, parameters: ['', 0, 0, 2] },
      { code: 401, indent: 0, parameters: ['【リナ】'] },
      { code: 401, indent: 0, parameters: ['おはよう'] },
      { code: 0, indent: 0, parameters: [] },
    ];
    system.switches = [];
    system.switches[7] = '朝';
  });
  const pattern = '^(?:\\\\[A-Za-z]+\\[\\d+\\])*【(.+?)】(?:\\\\[A-Za-z]+\\[\\d+\\])*$';
  const scenes = await buildScenes(proj, units, 'data/CommonEvents.json', pattern);
  expect(scenes).toHaveLength(1);
  expect(scenes[0].label).toBe('커먼이벤트1');
  expect(scenes[0].condition).toBe('스위치 7 [朝] 켜짐일 때 자동 실행');
  expect(scenes[0].lines[0].speaker).toBe('リナ');
});

test('다른 파일과 장면이 없는 파일', async () => {
  const { proj, units } = await project();
  expect(await buildScenes(proj, units, 'data/Items.json', null)).toEqual([]);
  expect(await buildScenes(proj, units, 'data/Nope.json', null)).toEqual([]);
});
