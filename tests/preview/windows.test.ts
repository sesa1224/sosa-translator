import { expect, test } from 'vitest';
import { unitWindows } from '../../src/core/preview/windows.js';
import type { TextUnit, UnitRef } from '../../src/core/types.js';

const lines = (file = 'data/Map001.json'): UnitRef => ({ type: 'lines', file, listPath: ['events', 1, 'pages', 0, 'list'], start: 1, count: 1, code: 401 });
const value = (file: string, ...path: (string | number)[]): UnitRef => ({ type: 'value', file, path });
const unit = (kind: TextUnit['kind'], ...refs: UnitRef[]): TextUnit => ({ id: 'u', kind, source: 'あ', needsDecision: false, refs });

test('대사는 대사창', () => {
  expect(unitWindows(unit('dialogue', lines()))).toEqual({ windows: ['message'], fixable: true });
  expect(unitWindows(unit('dialogue', lines(), lines('data/CommonEvents.json')))).toEqual({ windows: ['message'], fixable: true });
});

test('아이템·무기·방어구·스킬 설명은 설명창', () => {
  for (const f of ['Items', 'Weapons', 'Armors', 'Skills']) {
    expect(unitWindows(unit('db', value(`data/${f}.json`, 3, 'description')))).toEqual({ windows: ['help'], fixable: true });
  }
});

test('그 밖은 창 없음: 이름, 전투 문구, 프로필, 선택지, 스크롤 글', () => {
  const none = { windows: [], fixable: false };
  expect(unitWindows(unit('db', value('data/Items.json', 3, 'name')))).toEqual(none);
  expect(unitWindows(unit('db', value('data/Skills.json', 3, 'message1')))).toEqual(none);
  expect(unitWindows(unit('db', value('data/Actors.json', 1, 'profile')))).toEqual(none);
  expect(unitWindows(unit('db', value('data/States.json', 1, 'description')))).toEqual(none);
  expect(unitWindows(unit('choice', { type: 'choice', file: 'data/Map001.json', listPath: [], index: 0, choice: 0 }))).toEqual(none);
  expect(unitWindows(unit('scroll', { type: 'lines', file: 'data/Map001.json', listPath: [], start: 1, count: 1, code: 405 }))).toEqual(none);
  expect(unitWindows(unit('plugin-param', value('js/plugins.js', 0, 'parameters', 'x')))).toEqual(none);
});

test('여러 자리에 쓰인 문장: 다른 자리가 섞이면 재기만 하고 고치지 않는다', () => {
  expect(unitWindows(unit('db', value('data/Items.json', 3, 'description'), value('data/Skills.json', 9, 'description')))).toEqual({ windows: ['help'], fixable: true });
  expect(unitWindows(unit('db', value('data/Items.json', 3, 'description'), value('data/Items.json', 4, 'name')))).toEqual({ windows: ['help'], fixable: false });
});
