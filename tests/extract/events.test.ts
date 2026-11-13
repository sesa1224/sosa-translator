import { expect, test } from 'vitest';
import { extractFromList } from '../../src/core/extract/events.js';
import { miniCommonEvents, miniMap } from '../helpers/miniGame.js';

const list = miniMap('MZ').events[1]!.pages[0].list;
const commonList = miniCommonEvents()[1]!.list;

const P = ['events', 1, 'pages', 0, 'list'];
test('대사 묶음과 화자', () => {
  const u = extractFromList(list, 'data/Map001.json', P);
  const d = u.filter(x => x.kind === 'dialogue');
  expect(d.map(x => x.source)).toEqual(['あれ？\\N[1]じゃない！\nこんな夜に来るなんて', 'やった！']);
  expect(d[0].speaker).toBe('リナ');
  expect(d[0].ref).toEqual({ type: 'lines', file: 'data/Map001.json', listPath: P, start: 1, count: 2, code: 401 });
  expect(d[1].ref).toMatchObject({ start: 6, count: 1 });
});
test('선택지는 102에서만', () => {
  const c = extractFromList(list, 'data/Map001.json', P).filter(x => x.kind === 'choice');
  expect(c.map(x => x.source)).toEqual(['いいよ', 'また今度']);
  expect(c[1].ref).toEqual({ type: 'choice', file: 'data/Map001.json', listPath: P, index: 3, choice: 1 });
});
test('플러그인 커맨드는 판단 필요', () => {
  const p = extractFromList(list, 'data/Map001.json', P).find(x => x.kind === 'plugin-command')!;
  expect(p.source).toBe('ShowRecord 記録'); expect(p.needsDecision).toBe(true);
});
test('화자 이름도 값으로 나온다', () => {
  const s = extractFromList(list, 'data/Map001.json', P).filter(x => x.kind === 'db' && x.source === 'リナ');
  expect(s).toHaveLength(2);
});
test('스크롤 문장', () => {
  const u = extractFromList(commonList, 'data/CommonEvents.json', [1, 'list']);
  expect(u).toEqual([expect.objectContaining({ kind: 'scroll', source: 'むかしむかし', ref: expect.objectContaining({ start: 1, count: 1, code: 405 }) })]);
});
test('null 과 배열 아닌 값에 죽지 않는다', () => {
  expect(extractFromList(null, 'f', [])).toEqual([]); expect(extractFromList([null, { code: 401 }], 'f', [])).toEqual([]);
});

// Extra coverage for command codes the mini game does not use.
test('이름 변경, 스크립트, 주석, MZ 플러그인 커맨드', () => {
  const extra = [
    { code: 320, indent: 0, parameters: [1, '新しい名前'] },
    { code: 355, indent: 0, parameters: ['$gameMessage.add("こんにちは")'] },
    { code: 655, indent: 0, parameters: ['console.log("ok")'] },
    { code: 655, indent: 0, parameters: ['var a = "テスト"'] },
    { code: 108, indent: 0, parameters: ['<メモ>'] },
    { code: 408, indent: 0, parameters: ['続き'] },
    { code: 357, indent: 0, parameters: ['Plugin', 'cmd', 'コマンド', { text: '表示', n: 3, en: 'abc' }] },
  ];
  const u = extractFromList(extra, 'data/Map002.json', ['x']);
  expect(u.map(x => [x.kind, x.source, x.needsDecision])).toEqual([
    ['name-change', '新しい名前', false],
    ['script', '$gameMessage.add("こんにちは")', true],
    ['script', 'var a = "テスト"', true],
    ['comment', '<メモ>', true],
    ['comment', '続き', true],
    ['plugin-command', '表示', true],
  ]);
  expect(u[2].ref).toEqual({ type: 'value', file: 'data/Map002.json', path: ['x', 3, 'parameters', 0] });
  expect(u[5].ref).toEqual({ type: 'value', file: 'data/Map002.json', path: ['x', 6, 'parameters', 3, 'text'] });
});
