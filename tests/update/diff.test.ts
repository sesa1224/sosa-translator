import { describe, expect, test } from 'vitest';
import { diffUnits, similarity, stripPunctuation } from '../../src/core/update/diff.js';
import { mergeUnits } from '../../src/core/extract/index.js';
import type { RawUnit } from '../../src/core/extract/events.js';
import type { PathSeg, TextUnit, UnitKind } from '../../src/core/types.js';

const P: PathSeg[] = ['events', 1, 'pages', 0, 'list'];

function line(source: string, start: number, file = 'data/Map001.json', listPath: PathSeg[] = P): RawUnit {
  return { kind: 'dialogue', source, needsDecision: false, ref: { type: 'lines', file, listPath, start, count: 1, code: 401 } };
}
function choice(source: string, index: number, n: number, file = 'data/Map001.json'): RawUnit {
  return { kind: 'choice', source, needsDecision: false, ref: { type: 'choice', file, listPath: P, index, choice: n } };
}
function value(kind: UnitKind, source: string, file: string, path: PathSeg[]): RawUnit {
  return { kind, source, needsDecision: false, ref: { type: 'value', file, path } };
}
const units = (raw: RawUnit[]): TextUnit[] => mergeUnits(raw);
const idOf = (list: TextUnit[], source: string) => list.find((u) => u.source === source)!.id;

describe('similarity', () => {
  test('비슷한 문장, 다른 문장, 같은 글, 제어문자', () => {
    expect(similarity('月光草を集める', '月光草を三本集める')).toBeGreaterThanOrEqual(0.75);
    expect(similarity('今日はいい天気ですね', '魔王を倒しに行くぞ')).toBeLessThan(0.3);
    expect(similarity('こんにちは', 'こんにちは')).toBe(1);
    expect(similarity('\\C[2]あ\\C[0]い', 'あい')).toBe(1);
  });
  test('짧은 글', () => {
    expect(similarity('あ', 'あ')).toBe(1);
    expect(similarity('あ', 'い')).toBe(0);
  });
});

test('stripPunctuation 은 문장부호와 공백만 뺀다', () => {
  expect(stripPunctuation('あれ？ \\N[1]じゃない！')).toBe('あれ\\N[1]じゃない');
  expect(stripPunctuation('「やった……♥」\n　ね')).toBe('やったね');
});

describe('diffUnits', () => {
  test('원문이 같은 문장이 다른 맵으로 옮겨 가면 kept', () => {
    const a = units([line('ここは森だ', 1)]);
    const b = units([line('ここは森だ', 5, 'data/Map002.json')]);
    const d = diffUnits(a, b);
    expect(d.kept).toEqual([a[0].id]);
    expect(d.changed).toEqual([]);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(d.moved).toEqual([]);
  });

  test('같은 자리의 대사가 고쳐지면 changed 한 쌍', () => {
    const a = units([line('こんな夜に来るなんて', 1)]);
    const b = units([line('こんな夜更けに来るなんて', 1)]);
    const d = diffUnits(a, b);
    expect(d.changed).toEqual([{ oldId: a[0].id, newId: b[0].id, similarity: expect.any(Number), punctuationOnly: false }]);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  test('문장부호만 바뀌면 punctuationOnly', () => {
    const a = units([line('やった！', 6)]);
    const b = units([line('やった！！', 6)]);
    expect(diffUnits(a, b).changed[0].punctuationOnly).toBe(true);
  });

  test('대사가 끼어들어 번호가 밀려도 밀린 대사는 kept', () => {
    const a = units([line('一つ目', 1), line('二つ目', 2), line('三つ目', 3)]);
    const b = units([line('新しい台詞', 1), line('一つ目', 2), line('二つ目', 3), line('三つ目', 4)]);
    const d = diffUnits(a, b);
    expect(d.kept.sort()).toEqual(a.map((u) => u.id).sort());
    expect(d.added).toEqual([idOf(b, '新しい台詞')]);
    expect(d.changed).toEqual([]);
  });

  test('같은 파일의 비슷한 문장은 자리가 달라도 changed, 다른 파일이면 짝짓지 않는다', () => {
    const oldS = '薬草を十本集めてきてほしいの';
    const newS = '薬草を二十本集めてきてほしいの';
    expect(similarity(oldS, newS)).toBeGreaterThanOrEqual(0.75);
    const a = units([line(oldS, 3)]);
    const same = units([line(newS, 9)]);
    const d1 = diffUnits(a, same);
    expect(d1.changed.map((c) => [c.oldId, c.newId])).toEqual([[a[0].id, same[0].id]]);
    const other = units([line(newS, 9, 'data/Map002.json')]);
    const d2 = diffUnits(a, other);
    expect(d2.changed).toEqual([]);
    expect(d2.added).toEqual([other[0].id]);
    expect(d2.removed).toEqual([a[0].id]);
  });

  test('옛 항목 하나가 새 항목 둘과 비슷하면 더 비슷한 쪽과만 짝짓는다', () => {
    const a = units([line('薬草を十本集めてきてほしいの', 3)]);
    const b = units([line('薬草を十本集めてきてほしいのよ', 8), line('薬草を二十本集めてきてほしいな', 12)]);
    const d = diffUnits(a, b);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0].newId).toBe(idOf(b, '薬草を十本集めてきてほしいのよ'));
    expect(d.added).toEqual([idOf(b, '薬草を二十本集めてきてほしいな')]);
  });

  test('종류가 다르면 짝짓지 않는다', () => {
    const a = units([line('また今度にしよう', 3)]);
    const b = units([choice('また今度にしようか', 3, 0)]);
    const d = diffUnits(a, b);
    expect(d.changed).toEqual([]);
    expect(d.added).toEqual([b[0].id]);
    expect(d.removed).toEqual([a[0].id]);
  });

  test('같은 자리의 값(데이터베이스)도 짝짓는다', () => {
    const a = units([value('db', '月光草', 'data/Items.json', [1, 'name'])]);
    const b = units([value('db', '満月草', 'data/Items.json', [1, 'name'])]);
    expect(diffUnits(a, b).changed).toHaveLength(1);
  });

  test('플러그인 JS 문자열은 같은 원문의 n번째로 id 가 정해져 위치가 밀려도 kept', () => {
    const js = (start: number, n: number): RawUnit => ({
      kind: 'plugin-js', source: '決定', needsDecision: true, decisionKey: 'js:Menu',
      ref: { type: 'js', file: 'js/plugins/Menu.js', start, end: start + 2, quote: '"' }, distinct: `js/plugins/Menu.js#${n}`,
    });
    const a = units([js(10, 0)]);
    const b = units([js(40, 0)]);
    const d = diffUnits(a, b);
    expect(d.kept).toEqual([a[0].id]);
    expect(d.moved).toEqual([]);
  });
});
