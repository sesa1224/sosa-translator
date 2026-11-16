import { expect, test } from 'vitest';
import { checkTranslation } from '../../src/core/check/format.js';
import { ellipsisIssue, gluedMoanIssue, maskIssue, notationIssues, roundBracketIssue, symbolCountIssue } from '../../src/core/check/notation.js';
import { defaultRules, normalizeGlossary } from '../../src/core/glossary/store.js';
import type { TextUnit } from '../../src/core/types.js';

const u = (source: string, needsDecision = false): TextUnit => ({ id: 'i', kind: 'dialogue', source, needsDecision, refs: [] });

test('말끝에 붙은 읏: 낱말 뒤는 경고, 신음끼리는 괜찮다', () => {
  for (const ok of ['으읏', '크으읏', '하읏', '읏……', '응, 으읏!', '흐읏…… 하아']) expect(gluedMoanIssue(ok), ok).toBeNull();
  for (const bad of ['닿고 있어읏', '안 돼읏', '까지읏', '무리야읏……']) expect(gluedMoanIssue(bad), bad).toMatchObject({ rule: 'notation', severity: 'warning' });
});

test('가린 글자: 낱말 속 하나짜리 가림 기호가 번역에 남으면 경고', () => {
  expect(maskIssue('お○んこ', '보○')).toMatchObject({ rule: 'notation' });
  expect(maskIssue('ち×ぽ', '자×')).toMatchObject({ rule: 'notation' });
  expect(maskIssue('お○んこ', '보지')).toBeNull();
  // Deliberately hidden names and numbers keep their marks.
  expect(maskIssue('○○さん', '○○ 씨')).toBeNull();
  expect(maskIssue('××年', '××년')).toBeNull();
  // A mask standing alone in the source is not a masked word.
  expect(maskIssue('答え：○', '답: ○')).toBeNull();
});

test('말줄임표: … 하나는 …… 둘, 둘 넘으면 같은 개수', () => {
  expect(ellipsisIssue('あ…', '아……')).toBeNull();
  expect(ellipsisIssue('あ・・・', '아……')).toBeNull();
  expect(ellipsisIssue('あ…', '아...')).toMatchObject({ rule: 'notation' });
  expect(ellipsisIssue('あ…', '아…')).toMatchObject({ rule: 'notation' });
  expect(ellipsisIssue('あ………', '아………')).toBeNull();
  expect(ellipsisIssue('あ………', '아……')).toMatchObject({ rule: 'notation' });
  expect(ellipsisIssue('あ…い…', '아……이……')).toBeNull();
  // Restructured sentence: the run counts differ, nothing is compared.
  expect(ellipsisIssue('あ…い…', '아…… 이')).toBeNull();
  expect(ellipsisIssue('あ', '아')).toBeNull();
});

test('기호 개수: 종류별로 다르면 하나의 경고에 그 종류를 적는다', () => {
  expect(symbolCountIssue('すき♥', '좋아♡')).toBeNull();
  expect(symbolCountIssue('え？！', '어?!')).toBeNull();
  expect(symbolCountIssue('ねえ〜', '있잖아~')).toBeNull();
  const i = symbolCountIssue('すき♥♥', '좋아♥');
  expect(i).toMatchObject({ rule: 'notation', severity: 'warning' });
  expect(i!.message).toContain('♥');
  const two = symbolCountIssue('♪え？', '어');
  expect(two!.message).toContain('♪');
  expect(two!.message).toContain('?');
  // \! is a control code (wait for a key), not an exclamation mark.
  expect(symbolCountIssue('あ\\!い', '아\\!이')).toBeNull();
});

test('반각 괄호 규칙이 켜져 있으면 전각 둥근 괄호가 남은 것은 경고', () => {
  expect(roundBracketIssue('（웃음）')).toMatchObject({ rule: 'notation' });
  expect(roundBracketIssue('(웃음)')).toBeNull();
});

test('notationIssues 는 규칙에 따라 고른다', () => {
  const on = { unmask: true, brackets: true };
  expect(notationIssues('お○んこ（笑）', '보○（웃음）', on).length).toBe(2);
  expect(notationIssues('お○んこ（笑）', '보○（웃음）', { unmask: false, brackets: false })).toEqual([]);
});

test('checkTranslation: 표기 검사는 규칙이 켜졌을 때만, 판단 필요 항목은 빼고, 경고로만', () => {
  const rules = defaultRules();
  const issues = checkTranslation(u('安心して…'), '안심해…', rules);
  expect(issues).toEqual([expect.objectContaining({ rule: 'notation', severity: 'warning' })]);
  expect(checkTranslation(u('安心して…'), '안심해…', { ...rules, notationCheck: false })).toEqual([]);
  expect(checkTranslation(u('安心して…', true), '안심해…', rules)).toEqual([]);
  expect(checkTranslation(u('お○んこ'), '보○', { ...rules, unmask: false })).toEqual([]);
  expect(checkTranslation(u('お○んこ'), '보○', rules).map((i) => i.rule)).toEqual(['notation']);
  expect(checkTranslation(u('（笑）'), '（웃음）', { ...rules, halfWidthBrackets: false })).toEqual([]);
  expect(checkTranslation(u('（笑）'), '（웃음）', { ...rules, halfWidth: false })).toEqual([]);
});

test('표기 규칙의 기본값: 키가 없는 파일은 켜짐', () => {
  expect(defaultRules()).toMatchObject({ notationCheck: true, unmask: true });
  expect(normalizeGlossary({ rules: {} }).rules).toMatchObject({ notationCheck: true, unmask: true });
  expect(normalizeGlossary({ rules: { notationCheck: false, unmask: false } }).rules).toMatchObject({ notationCheck: false, unmask: false });
});
