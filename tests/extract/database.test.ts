import { expect, test } from 'vitest';
import { extractFromDataFile } from '../../src/core/extract/database.js';
import { miniActors, miniCommonEvents, miniMap, miniSystem } from '../helpers/miniGame.js';

const actors = miniActors();
const system = miniSystem();
const map = miniMap('MZ');

test('액터', () => {
  const u = extractFromDataFile('Actors.json', actors);
  expect(u.map(x => [x.source, x.ref])).toEqual([
    ['リナ', { type: 'value', file: 'data/Actors.json', path: [1, 'name'] }],
    ['薬草園の見習い', { type: 'value', file: 'data/Actors.json', path: [1, 'profile'] }]]);
});
test('시스템 용어: 일본어만, null 건너뜀', () => {
  const s = extractFromDataFile('System.json', system).map(x => x.source);
  expect(s).toEqual(expect.arrayContaining(['霧の薬草園', 'ゴールド', 'レベル', 'たたかう', '最大HP', '常時ダッシュ', '物理', '魔法', '武器']));
  expect(s).not.toContain('Lv'); expect(s).not.toContain('');
});
test('맵: 표시 이름과 이벤트', () => {
  const u = extractFromDataFile('Map001.json', map);
  expect(u.find(x => x.kind === 'map-name')!.source).toBe('薬草園');
  expect(u.filter(x => x.kind === 'dialogue')).toHaveLength(2);
});
test('null 항목과 모르는 파일', () => {
  expect(extractFromDataFile('Classes.json', [null])).toEqual([]);
  expect(extractFromDataFile('Tilesets.json', [null, { name: 'タイル' }])).toEqual([]);
  expect(extractFromDataFile('Map002.json', { displayName: '', events: [null, null] })).toEqual([]);
});

// Extra coverage: system paths, common events and troops.
test('시스템 경로와 커먼 이벤트, 적 그룹', () => {
  const sys = extractFromDataFile('System.json', system);
  expect(sys.find(x => x.source === '常時ダッシュ')!.ref).toEqual({ type: 'value', file: 'data/System.json', path: ['terms', 'messages', 'alwaysDash'] });
  expect(sys.find(x => x.source === '武器')!.ref).toEqual({ type: 'value', file: 'data/System.json', path: ['equipTypes', 1] });
  expect(sys.every(x => x.kind === 'system')).toBe(true);
  const ce = extractFromDataFile('CommonEvents.json', miniCommonEvents());
  expect(ce.map(x => [x.kind, x.ref.file])).toEqual([['scroll', 'data/CommonEvents.json']]);
  expect(ce[0].ref).toMatchObject({ listPath: [1, 'list'] });
  const troops = [null, { id: 1, pages: [{ list: [{ code: 101, indent: 0, parameters: ['', 0, 0, 2] }, { code: 401, indent: 0, parameters: ['来たな！'] }] }] }];
  expect(extractFromDataFile('Troops.json', troops)[0].ref).toMatchObject({ file: 'data/Troops.json', listPath: [1, 'pages', 0, 'list'], start: 1 });
});
