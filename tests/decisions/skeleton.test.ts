import { expect, test } from 'vitest';
import { japaneseSpans, keepPieces, shapeOf } from '../../src/core/decisions/keys.js';
import { checkSkeleton } from '../../src/core/decisions/skeleton.js';
import { checkTranslation } from '../../src/core/check/format.js';
import type { KeepRule } from '../../src/core/decisions/types.js';
import type { TextUnit } from '../../src/core/types.js';

const args11: KeepRule = { mode: 'args', from: 1, dropLast: 1 };
const spans: KeepRule = { mode: 'spans' };

test('shapeOf', () => {
  expect(shapeOf('"1_t=2_subject=おっぱい弄られた回数：\\\\V[81]"])')).toBe('"#_t=#_subject=◆\\\\V[#]"])');
});

test('japaneseSpans: 제어문자와 문법 글자 밖의 일본어만', () => {
  const s = 'ShowInfo _SE[Item1]\\C[27]オートセーブ\\C[0]';
  const sp = japaneseSpans(s);
  expect(sp.map((x) => s.slice(x.start, x.end))).toEqual(['オートセーブ']);
  const t = '"1_t=2_subject=回数：\\\\V[81]"])';
  expect(japaneseSpans(t).map((x) => t.slice(x.start, x.end))).toEqual(['回数：']);
  expect(japaneseSpans('abc = 1')).toEqual([]);
});

test('keepPieces', () => {
  expect(keepPieces('addLog アーテルは\\C[5]ギア\\C[0]を訓練に誘った', { mode: 'args', from: 1, dropLast: 0 })).toEqual(['addLog ', '']);
  expect(keepPieces('D_TEXT 筋力\\V[22] 32', args11)).toEqual(['D_TEXT ', ' 32']);
  expect(keepPieces('D_TEXT 32', args11)).toBeNull();
  expect(keepPieces('記録', { mode: 'whole' })).toEqual(['', '']);
  expect(keepPieces('"1_t=2_subject=回数：\\\\V[81]"])', spans)).toEqual(['"1_t=2_subject=', '\\\\V[81]"])']);
  expect(keepPieces('abc', spans)).toBeNull();
});

test('checkSkeleton: args', () => {
  expect(checkSkeleton('D_TEXT 筋力\\V[22] 32', 'D_TEXT 근력\\V[22] 32', args11)).toEqual([]);
  const bad = checkSkeleton('D_TEXT 筋力\\V[22] 32', 'D_TEXT 근력\\V[22] 28', args11);
  expect(bad).toEqual([{ rule: 'skeleton', severity: 'error', message: '그대로 둬야 하는 부분이 바뀌었습니다: " 32"' }]);
  expect(checkSkeleton('D_TEXT 筋力\\V[22] 32', '텍스트 근력 32', args11)).toEqual([
    { rule: 'skeleton', severity: 'error', message: '그대로 둬야 하는 부분이 바뀌었습니다: "D_TEXT "' }]);
  expect(checkSkeleton('D_TEXT 筋力 32', 'D_TEXT  32', args11)).toHaveLength(1);
});

test('checkSkeleton: spans', () => {
  const src = '"1_t=2_subject=回数：\\\\V[81]"])';
  expect(checkSkeleton(src, '"1_t=2_subject=횟수: \\\\V[81]"])', spans)).toEqual([]);
  expect(checkSkeleton(src, '"1_t=3_subject=횟수: \\\\V[81]"])', spans)).toHaveLength(1);
});

test('번역 구간의 $1, (, \\ 는 글자 그대로', () => {
  expect(checkSkeleton('D_TEXT 筋力 32', 'D_TEXT 근력$1(\\ 32', args11)).toEqual([]);
  expect(checkSkeleton('"x=回数"', '"x=$&$1(\\"', spans)).toEqual([]);
  // A piece holding regex characters must match literally.
  expect(checkSkeleton('a.b(c) 記録', 'a.b(c) 기록', { mode: 'args', from: 1, dropLast: 0 })).toEqual([]);
  expect(checkSkeleton('a.b(c) 記録', 'aXb(c) 기록', { mode: 'args', from: 1, dropLast: 0 })).toHaveLength(1);
});

test('checkTranslation 의 keep: 뼈대 검사와 번역 구간만의 제어문자 검사', () => {
  const unit: TextUnit = { id: 'u', kind: 'plugin-command', source: 'D_TEXT 筋力\\V[22] 32', needsDecision: true, refs: [] };
  expect(checkTranslation(unit, 'D_TEXT 근력\\V[22] 32', undefined, undefined, args11)).toEqual([]);
  const issues = checkTranslation(unit, 'D_TEXT 근력 32', undefined, undefined, args11);
  expect(issues.map((i) => i.rule)).toEqual(['control-codes']);
  expect(checkTranslation(unit, 'X 근력\\V[22] 32', undefined, undefined, args11).map((i) => i.rule)).toContain('skeleton');
  // Japanese in a kept piece is not "leftover".
  const kept: TextUnit = { ...unit, source: 'ShowPic 立ち絵 本文です' };
  expect(checkTranslation(kept, 'ShowPic 立ち絵 본문입니다', undefined, undefined, { mode: 'args', from: 2, dropLast: 0 })).toEqual([]);
});
