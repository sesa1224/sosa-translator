import { expect, test } from 'vitest';
import { checkTranslation } from '../../src/core/check/format.js';
import { fixJosa, hasFinalConsonant } from '../../src/core/glossary/josa.js';
import { checkGlossary, lineWidthChars, termsIn } from '../../src/core/glossary/match.js';
import { planRename } from '../../src/core/glossary/rename.js';
import { termId } from '../../src/core/glossary/store.js';
import type { Term, TermCategory } from '../../src/core/glossary/types.js';
import type { TextUnit, TranslationEntry } from '../../src/core/types.js';

const T = (source: string, target: string, category: TermCategory = 'term'): Term => ({ id: termId(source), source, target, category, status: 'confirmed', candidates: [] });

const D = (id: string, source: string): TextUnit => ({ id, kind: 'dialogue', source, needsDecision: false, refs: [] });
const units: TextUnit[] = [D('u1', '玃猿が来た'), D('u2', '玃猿の話'), D('u3', '猿が来た'), D('u4', '玃猿だ')];
const entries: Record<string, TranslationEntry> = {
  u1: { target: '확원이 왔다', status: 'needs-review', updatedAt: 't' },
  u2: { target: '확원이야기', status: 'needs-review', updatedAt: 't' },
  u3: { target: '확원이 왔다', status: 'needs-review', updatedAt: 't' },
};
const entryOf = (id: string): TranslationEntry => entries[id] ?? { target: null, status: 'untranslated', updatedAt: '' };

test('긴 용어부터', () => {
  const terms = [T('玃猿', '확원'), T('大玃猿', '큰 확원')];
  expect(termsIn('大玃猿が来た', terms).map(t => t.source)).toEqual(['大玃猿']);
  expect(termsIn('玃猿と大玃猿', terms).map(t => t.source)).toEqual(['玃猿', '大玃猿']);
});
test('용어 일치 검사', () => {
  expect(checkGlossary('月光草を集める', '달빛풀을 모은다', [T('月光草', '월광초')])[0]).toMatchObject({ rule: 'glossary', severity: 'warning' });
  expect(checkGlossary('月光草を集める', '월광초를 모은다', [T('月光草', '월광초')])).toEqual([]);
  expect(checkGlossary('ぐちゅぐちゅ', '질척질척', [T('ぐちゅぐちゅ', '찌걱찌걱', 'sfx')])).toHaveLength(1);
});
test('줄 폭', () => {
  expect(lineWidthChars('가나다 abc\\C[2]')).toBe(5); // 3 + 공백 0.5 + abc 1.5
  const u = { id: 'i', kind: 'dialogue', source: 'あ', needsDecision: false, refs: [] } as TextUnit;
  expect(checkTranslation(u, '가'.repeat(31), undefined, { terms: [], maxLineWidthChars: 30 })[0]).toMatchObject({ rule: 'line-width', severity: 'warning' });
  expect(checkTranslation({ ...u, source: 'あ'.repeat(40) }, '가'.repeat(31), undefined, { terms: [], maxLineWidthChars: 30 })).toEqual([]);
});
test('조사 맞춤', () => {
  const fix = (s: string, w: string) => fixJosa(s, s.indexOf(w) + w.length, w);
  expect(fix('리나를 봤다', '리나')).toEqual({ text: '리나를 봤다', certain: true });
  expect(fix('월광초을 모았다', '월광초')).toEqual({ text: '월광초를 모았다', certain: true });
  expect(fix('확원가 왔다', '확원')).toEqual({ text: '확원이 왔다', certain: true });
  expect(fix('샘로 간다', '샘')).toEqual({ text: '샘으로 간다', certain: true }); expect(fix('마을으로 간다', '마을')).toEqual({ text: '마을로 간다', certain: true });
  expect(fix('리나이야기', '리나')).toEqual({ text: '리나이야기', certain: false });   // 조사인지 알 수 없음
  expect(fix('리나 씨', '리나')).toEqual({ text: '리나 씨', certain: true });
  expect(fix('A가 왔다', 'A').certain).toBe(false);
});
test('용어 바꾸기 계획', () => {
  const plan = planRename(T('玃猿', '확원'), '원숭이', units, entryOf);
  expect(plan).toContainEqual({ id: 'u1', newTarget: '원숭이가 왔다', certain: true });   // '확원이 왔다'
  expect(plan.find(p => p.id === 'u2')).toMatchObject({ certain: false });                // '확원이야기'
  expect(plan.some(p => p.id === 'u3')).toBe(false);                                      // 원문에 용어 없음
});

// Extra coverage beyond the plan's assertions.
test('조사 그 밖의 경우', () => {
  expect(hasFinalConsonant('샘')).toBe(true); expect(hasFinalConsonant('리나')).toBe(false); expect(hasFinalConsonant('HP')).toBeNull();
  const fix = (s: string, w: string) => fixJosa(s, s.indexOf(w) + w.length, w);
  expect(fix('확원과 리나', '확원')).toEqual({ text: '확원과 리나', certain: true });
  expect(fix('리나과 확원', '리나')).toEqual({ text: '리나와 확원', certain: true });
  expect(fix('리나은\\C[0] 웃었다', '리나')).toEqual({ text: '리나는\\C[0] 웃었다', certain: true });
  expect(fix('확원이랑 놀았다', '확원')).toEqual({ text: '확원이랑 놀았다', certain: true });
  expect(fix('리나이랑 놀았다', '리나')).toEqual({ text: '리나랑 놀았다', certain: true });
  expect(fix('리나는', '리나')).toEqual({ text: '리나는', certain: true });
  expect(fix('확원야!', '확원')).toEqual({ text: '확원야!', certain: false });  // 부름(아)인지 서술(이야)인지 모름
  expect(fix('HP 회복', 'HP')).toEqual({ text: 'HP 회복', certain: true });
});
test('용어가 여러 번 나오면 모두 바꾼다', () => {
  const plan = planRename(T('玃猿', '확원'), '원숭이', [D('u4', '玃猿だ')], () => ({ target: '확원은 확원을 봤다', status: 'needs-review', updatedAt: 't' }));
  expect(plan).toEqual([{ id: 'u4', newTarget: '원숭이는 원숭이를 봤다', certain: true }]);
});
test('줄 폭은 줄마다', () => {
  const u = { id: 'i', kind: 'dialogue', source: 'あ'.repeat(40) + '\nい', needsDecision: false, refs: [] } as TextUnit;
  const issues = checkTranslation(u, '가'.repeat(31) + '\n' + '나'.repeat(31), undefined, { terms: [], maxLineWidthChars: 30 });
  expect(issues).toHaveLength(1); expect(issues[0].message).toContain('2');
  expect(checkTranslation(u, '월광초', undefined, { terms: [T('あ', '아')], maxLineWidthChars: null })[0]).toMatchObject({ rule: 'glossary' });
  expect(lineWidthChars('ｱｲ')).toBe(1);
});
