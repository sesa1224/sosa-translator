import { expect, test } from 'vitest';
import { checkAll, checkTranslation, DEFAULT_RULES } from '../../src/core/check/format.js';
import { TranslationStore } from '../../src/core/store/translations.js';
import type { TextUnit, UnitKind } from '../../src/core/types.js';
import { makeTempDir, cleanupTempDirs } from '../helpers/fs.js';
import { afterAll } from 'vitest';

afterAll(cleanupTempDirs);

const u = (source: string, kind: UnitKind = 'dialogue'): TextUnit => ({ id: 'i', kind, source, needsDecision: false, refs: [] });
test('통과', () => { expect(checkTranslation(u('月光草を\\C[4]3本\\C[0]'), '월광초를 \\C[4]3개\\C[0]')).toEqual([]); });
test('제어문자 누락과 순서 무관', () => {
  expect(checkTranslation(u('\\C[2]マナ\\C[0]'), '마나')[0]).toMatchObject({ rule: 'control-codes', severity: 'error' });
  expect(checkTranslation(u('\\V[1]と\\N[2]'), '\\N[2]와 \\V[1]')).toEqual([]);
});
test('남은 일본어', () => { expect(checkTranslation(u('やった'), '해냈다！やった')[0].rule).toBe('leftover-japanese'); });
test('빈 번역', () => { expect(checkTranslation(u('やった'), '  ')[0].rule).toBe('empty'); });
test('줄 수', () => {
  expect(checkTranslation(u('あ\nい'), '가\n나\n다')).toEqual([]);
  expect(checkTranslation(u('あ\nい'), '가\n나\n다', { ...DEFAULT_RULES, sameLineCount: true })[0]).toMatchObject({ rule: 'line-count', severity: 'error' });
  expect(checkTranslation(u('あ'), '1\n2\n3\n4\n5')[0]).toMatchObject({ rule: 'line-count', severity: 'warning' });
  expect(checkTranslation(u('あ', 'db'), '1\n2\n3\n4\n5')).toEqual([]);
});

// Extra coverage.
test('제어문자 메시지에 빠진 것과 더해진 것', () => {
  const [i] = checkTranslation(u('\\C[2]マナ'), '\\V[1]마나');
  expect(i.message).toContain('\\C[2]'); expect(i.message).toContain('\\V[1]');
});
test('checkAll: 문제 있는 항목만, error 는 상태를 바꾼다', async () => {
  const store = await TranslationStore.load(await makeTempDir());
  const units: TextUnit[] = [
    { id: 'a', kind: 'dialogue', source: 'あ', needsDecision: false, refs: [] },
    { id: 'b', kind: 'dialogue', source: 'い', needsDecision: false, refs: [] },
    { id: 'c', kind: 'dialogue', source: 'う', needsDecision: false, refs: [] },
    { id: 'd', kind: 'dialogue', source: 'え', needsDecision: false, refs: [] },
  ];
  store.set('a', '아'); store.set('b', 'いい'); store.set('c', '1\n2\n3\n4\n5', 'approved');
  const r = checkAll(units, store);
  expect(r.map(x => x.id)).toEqual(['b', 'c']);
  expect(store.get('a').status).toBe('needs-review');
  expect(store.get('b').status).toBe('error');
  expect(store.get('c').status).toBe('approved'); // warning only
  store.set('b', '이이', 'error');
  expect(checkAll(units, store)).toHaveLength(1);
  expect(store.get('b').status).toBe('needs-review'); // fixed -> no longer error
});
