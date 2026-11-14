import { expect, test } from 'vitest';
import { buildPackage } from '../../src/core/exchange/package.js';
import { defaultGlossary, normalizeGlossary } from '../../src/core/glossary/store.js';
import { finalPrompt, promptText, withPromptText } from '../../src/core/glossary/prompts.js';
import type { Glossary } from '../../src/core/glossary/types.js';
import { buildTranslatePrompt, type Batch } from '../../src/main/translate/batches.js';
import { buildReviewPrompt } from '../../src/main/translate/review.js';

const g = (): Glossary => ({ ...defaultGlossary(), styleGuide: '## 태도\n- 자연스럽게, $& 도 그대로' });
const batch = (previous: boolean): Batch => ({
  label: 'x', file: 'data/Map001.json', context: [],
  items: [{ i: 0, id: 'a', kind: 'dialogue', speaker: null, speakerLine: null, text: 'あ', ...(previous ? { previous: { source: 'あ', target: '아' } } : {}) }],
} as unknown as Batch);
const meta = { name: 'p', engine: 'MV', gameDir: '', contentPrefix: '', sourceLang: 'ja', targetLang: 'ko', versions: [], current: 'v1' };
const exported = (gl: Glossary) => buildPackage({ meta: meta as any, units: [], entryOf: () => ({ target: null, status: 'untranslated', updatedAt: '' }), glossary: gl, decisions: {}, ids: [] }).instructions;

test('보내는 글은 화면에 보이는 글과 같다', () => {
  expect(buildTranslatePrompt(batch(true), g()).system).toBe(promptText('translate', g()));
  expect(buildReviewPrompt({ label: 'x', file: 'f', items: [] }, g()).system).toBe(promptText('review', g()));
  expect(exported(g())).toBe(promptText('export', g()));
  expect(promptText('translate', g())).toContain('## 태도\n- 자연스럽게, $& 도 그대로');
});
test('바뀐 문장이 없는 묶음에는 previous 줄이 붙지 않는다', () => {
  const without = buildTranslatePrompt(batch(false), g()).system;
  expect(without).not.toContain('원문이 조금 바뀐 문장'); expect(without.endsWith('그 사이의 글자만 번역한다.')).toBe(true);
  expect(buildTranslatePrompt(batch(true), g()).system).toContain('원문이 조금 바뀐 문장');
});
test('고치지 않고 저장하면 기본 그대로 남는다', () => {
  for (const kind of ['translate', 'review', 'export'] as const) {
    const out = withPromptText(g(), kind, promptText(kind, g()) + '\n');
    expect(out.prompts).toBeUndefined(); expect(out.styleGuide).toBe(g().styleGuide);
  }
});
test('태그 사이를 고치면 같이 쓰는 지침이 바뀐다', () => {
  const text = promptText('export', g()).replace('- 자연스럽게', '- 딱딱하지 않게');
  const out = withPromptText(g(), 'export', text);
  expect(out.styleGuide).toBe('## 태도\n- 딱딱하지 않게, $& 도 그대로'); expect(out.prompts).toBeUndefined();
  expect(promptText('translate', out)).toContain('딱딱하지 않게');
});
test('덧붙는 문구를 고치면 그 글이 그대로 나간다', () => {
  const edited = promptText('export', g()).replace('before/after 는 앞뒤 대사로 참고만 한다.', '앞뒤 대사도 꼭 읽는다.');
  const out = withPromptText(g(), 'export', edited);
  expect(exported(out)).toBe(edited); expect(exported(out)).not.toContain('참고만 한다');
  expect(promptText('translate', out)).toBe(promptText('translate', g()));   // other kinds keep the default
  // Lines the user left alone still follow the rules.
  const wide = { ...out, rules: { ...out.rules, maxLineWidthChars: 20 } };
  expect(exported(wide)).toContain('한글 20자'); expect(exported(wide)).toContain('앞뒤 대사도 꼭 읽는다.');
  expect(normalizeGlossary(JSON.parse(JSON.stringify(out))).prompts).toEqual(out.prompts);
});
test('형식 규칙 줄을 고치면 고친 대로 굳는다', () => {
  const edited = promptText('translate', g()).replace('- 대사(kind 가 dialogue)는 4줄을 넘기지 않는다.', '- 대사는 3줄까지.');
  const out = withPromptText(g(), 'translate', edited);
  const later = { ...out, rules: { ...out.rules, maxLines: 2 } };
  expect(finalPrompt('translate', later, { previous: true })).toBe(edited);
});
test('태그를 지우면 적은 글만 나가고, null 이나 빈 글은 기본으로 돌아간다', () => {
  const out = withPromptText(g(), 'review', '이 글만 보낸다.');
  expect(finalPrompt('review', out)).toBe('이 글만 보낸다.'); expect(out.styleGuide).toBe(g().styleGuide);
  expect(withPromptText(out, 'review', null).prompts).toBeUndefined();
  expect(withPromptText(out, 'review', '  \n').prompts).toBeUndefined();
});
