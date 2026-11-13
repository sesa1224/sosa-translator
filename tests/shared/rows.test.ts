import { expect, test } from 'vitest';
import type { TextUnit, UnitRef } from '../../src/core/types.js';
import type { Row } from '../../src/shared/api.js';
import { computeScopes, computeStats, filterRows, locationLabel, scopeLabel, toRow } from '../../src/shared/rows.js';

function unitAt(ref: UnitRef): TextUnit {
  return { id: 'u', kind: 'dialogue', source: 'x', needsDecision: false, refs: [ref] };
}

function row(p: Partial<Row> & { id: string; source: string; file: string }): Row {
  return { kind: 'db', target: null, status: 'untranslated', needsDecision: false, location: '', refCount: 1, usesProvisional: false, ...p };
}

const rows: Row[] = [
  row({ id: 'actor-name', source: 'リナ', file: 'data/Actors.json' }),
  row({ id: 'item-name', source: '月光草', file: 'data/Items.json', target: '월광초', status: 'needs-review' }),
  row({ id: 'item-desc', source: '夜に光る草。\\C[2]貴重\\C[0]だ', file: 'data/Items.json' }),
  row({ id: 'map-1', kind: 'dialogue', speaker: 'リナ', source: 'あれ？\\N[1]じゃない！', file: 'data/Map001.json' }),
  row({ id: 'map-2', kind: 'dialogue', speaker: 'リナ', source: 'やった！', file: 'data/Map001.json' }),
  row({ id: 'cmd-1', kind: 'plugin-command', source: 'ShowRecord 記録', file: 'data/Map001.json', needsDecision: true }),
  row({ id: 'plugin-1', kind: 'plugin-param', source: '記録', file: 'js/plugins.js', needsDecision: true }),
];

test('위치 이름', () => {
  expect(locationLabel(unitAt({ type: 'lines', file: 'data/Map004.json', listPath: ['events', 3, 'pages', 0, 'list'], start: 1, count: 2, code: 401 }))).toBe('맵4 · 이벤트3');
  expect(locationLabel(unitAt({ type: 'lines', file: 'data/Map004.json', listPath: ['events', 3, 'pages', 1, 'list'], start: 1, count: 1, code: 401 }))).toBe('맵4 · 이벤트3 · 2페이지');
  expect(locationLabel(unitAt({ type: 'value', file: 'data/Items.json', path: [1, 'name'] }))).toBe('Items · 1');
  expect(locationLabel(unitAt({ type: 'value', file: 'js/plugins.js', path: [0, 'parameters', 'title'] }))).toBe('플러그인 설정');
  expect(scopeLabel('data/Map004.json')).toBe('맵4'); expect(scopeLabel('data/CommonEvents.json')).toBe('커먼이벤트');
});
test('검색은 글자 그대로', () => {
  expect(filterRows(rows, { text: '\\C[2]' }).map(r => r.id)).toEqual(['item-desc']);
  expect(filterRows(rows, { text: '(' })).toEqual([]); expect(filterRows(rows, { text: '월광' }).map(r => r.id)).toEqual(['item-name']);
  expect(filterRows(rows, { text: 'リナ' }).length).toBeGreaterThan(1); // 화자로도 찾는다
});
test('상태 필터와 통계', () => {
  expect(filterRows(rows, { status: 'needs-decision' }).every(r => r.needsDecision)).toBe(true);
  expect(filterRows(rows, { status: 'untranslated', file: 'data/Items.json' }).map(r => r.id)).toEqual(['item-desc']);
  expect(computeStats(rows)).toEqual({ total: rows.length, untranslated: rows.length - 1, needsReview: 1, approved: 0, error: 0, needsDecision: 2, declined: 0, provisional: 0, external: 0, undecided: 2, changed: 0, carried: 0 });
  expect(computeScopes(rows).find(s => s.file === 'data/Items.json')).toEqual({ file: 'data/Items.json', label: 'Items', total: 2, done: 1 });
});

// Extra coverage beyond the plan's assertions.
test('그 밖의 위치 이름과 toRow', () => {
  expect(locationLabel(unitAt({ type: 'lines', file: 'data/CommonEvents.json', listPath: [7, 'list'], start: 0, count: 1, code: 401 }))).toBe('커먼이벤트7');
  expect(locationLabel(unitAt({ type: 'value', file: 'data/System.json', path: ['gameTitle'] }))).toBe('시스템');
  expect(locationLabel(unitAt({ type: 'value', file: 'data/Map004.json', path: ['displayName'] }))).toBe('맵4');
  expect(scopeLabel('js/plugins.js')).toBe('플러그인 설정'); expect(scopeLabel('data/Skills.json')).toBe('Skills');
  const u: TextUnit = { id: 'a', kind: 'dialogue', speaker: 'リナ', source: 'やった！', needsDecision: false,
    refs: [{ type: 'lines', file: 'data/Map001.json', listPath: ['events', 1, 'pages', 0, 'list'], start: 6, count: 1, code: 401 },
      { type: 'value', file: 'data/Items.json', path: [1, 'name'] }] };
  expect(toRow(u, { target: '해냈다!', status: 'approved', updatedAt: 't' })).toEqual({
    id: 'a', kind: 'dialogue', speaker: 'リナ', source: 'やった！', target: '해냈다!', status: 'approved', needsDecision: false,
    file: 'data/Map001.json', location: '맵1 · 이벤트1', refCount: 2, usesProvisional: false, decision: null, external: false });
  expect(filterRows(rows, { text: 'showrecord' }).map(r => r.id)).toEqual(['cmd-1']);
});
