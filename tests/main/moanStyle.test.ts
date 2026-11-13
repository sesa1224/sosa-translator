// 인물별 신음 스타일 (계획 3 추가 요구)
import { expect, test } from 'vitest';
import { checkTranslation } from '../../src/core/check/format.js';
import { defaultGlossary, normalizeGlossary, termId } from '../../src/core/glossary/store.js';
import type { Glossary, Term } from '../../src/core/glossary/types.js';
import { SPEAKER_PRESETS } from '../../src/core/text/speaker.js';
import type { TextUnit } from '../../src/core/types.js';
import { buildTranslatePrompt, planBatches } from '../../src/main/translate/batches.js';
import { buildDraftPrompt, DRAFT_SCHEMA, mergeDraft } from '../../src/main/translate/draft.js';
import { collectMaterial, isMoanLine } from '../../src/main/translate/material.js';
import { buildReviewPrompt, planReview } from '../../src/main/translate/review.js';

const bracket = SPEAKER_PRESETS.find((p) => p.id === 'bracket')!.pattern;
const D = (id: string, source: string, speaker?: string): TextUnit =>
  ({ id, kind: 'dialogue', source, needsDecision: false, refs: [{ type: 'value', file: 'data/Map001.json', path: [id] }], ...(speaker ? { speaker } : {}) });
const sfx: Term = { id: termId('ぐちゅぐちゅ'), source: 'ぐちゅぐちゅ', target: '찌걱찌걱', category: 'sfx', status: 'confirmed', candidates: [] };

test('지침에 인물별 신음 원칙이 들어간다', () => {
  const g = defaultGlossary().styleGuide;
  expect(g).toContain('신음과 감탄 소리는 인물의 성격과 그 장면의 상태에 맞춘다');
  expect(g).toContain('인물 카드에 신음 스타일이 있으면 그것을 따른다');
  expect(g).toContain('효과음(사물·동작 소리)은 게임 전체에서 같은 말로 옮긴다');
  expect(g).toContain('신음은 이 규칙에서 빼고 인물별 스타일을 따른다');
});

test('자료에 인물별 신음 대사가 따로 모인다', () => {
  expect(isMoanLine('「あっ…んんっ♥　だめぇ…」')).toBe(true);
  expect(isMoanLine('「ギルドの依頼は無料で受ける」')).toBe(false);
  const units = [D('1', '【アーテル】\n「あっ…んんっ♥　だめぇ…」'), D('2', '【アーテル】\n「はぁ…はぁ…」'),
    D('3', '【アーテル】\n「ギルドの依頼はもちろん無料で受けるわ」'), D('4', '【ギア】\n「くっ…ふぅっ…」')];
  const m = collectMaterial(units, bracket);
  expect(m.samples.find((s) => s.speaker === 'アーテル')!.moans).toEqual(['「あっ…んんっ♥　だめぇ…」', '「はぁ…はぁ…」']);
  expect(m.samples.find((s) => s.speaker === 'ギア')).toMatchObject({ lines: [], moans: ['「くっ…ふぅっ…」'] });
});

test('초안: 스키마와 프롬프트에 moanStyle, 합치면 카드로 옮겨진다', () => {
  expect(JSON.stringify(DRAFT_SCHEMA)).toContain('moanStyle');
  expect(buildDraftPrompt(collectMaterial([], null), 'G').system).toContain('moanStyle');
  const g = mergeDraft(defaultGlossary(), { terms: [], styleNotes: '', characters: [
    { source: 'アーテル', target: '아텔', speech: '반말', moanStyle: '참다가 새는 짧은 소리. 받침으로 끊는다' },
    { source: 'ギア', target: '기어', speech: '거친 말투' }] }, null);
  expect(g.characters[0].moanStyle).toBe('참다가 새는 짧은 소리. 받침으로 끊는다');
  expect('moanStyle' in g.characters[1]).toBe(false);
  expect(normalizeGlossary(JSON.parse(JSON.stringify(g))).characters[0].moanStyle).toBe('참다가 새는 짧은 소리. 받침으로 끊는다');
});

test('번역과 검수 프롬프트에 moanStyle 이 실린다', () => {
  const g: Glossary = { ...defaultGlossary(), rules: { ...defaultGlossary().rules, speakerPattern: bracket },
    characters: [{ id: 'a', source: 'アーテル', target: '아텔', speech: '반말', moanStyle: '길고 열린 소리' }] };
  const units = [D('1', '【アーテル】\n「あっ…」')];
  const batch = planBatches(units, () => ({ target: null, status: 'untranslated', updatedAt: '' }), g)[0];
  expect(JSON.parse(buildTranslatePrompt(batch, g).user).characters[0]).toMatchObject({ name: 'アーテル', moanStyle: '길고 열린 소리' });
  const rb = planReview(units, () => ({ target: '【아텔】\n「앗……」', status: 'needs-review', updatedAt: 't' }), g, { scope: 'all' }).batches[0];
  const rp = buildReviewPrompt(rb, g);
  expect(JSON.parse(rp.user).characters[0].moanStyle).toBe('길고 열린 소리');
  expect(rp.system).toContain('인물의 성격·신음 스타일과 맞지 않는 신음 표기');
});

test('효과음 용어는 화자 있는 대사에는 강제하지 않고, 지문에는 강제한다', () => {
  const check = { terms: [sfx], maxLineWidthChars: null, speakerPattern: bracket };
  expect(checkTranslation(D('1', '【アーテル】\n「ぐちゅぐちゅ…」'), '【아텔】\n「질척질척……」', undefined, check)).toEqual([]);
  expect(checkTranslation(D('2', '「ぐちゅぐちゅ…」', 'リナ'), '「질척질척……」', undefined, check)).toEqual([]);
  expect(checkTranslation(D('3', 'ぐちゅぐちゅと音がした'), '질척질척 소리가 났다', undefined, check)[0]).toMatchObject({ rule: 'glossary' });
  expect(checkTranslation({ ...D('4', 'ぐちゅぐちゅ'), kind: 'db' }, '질척질척', undefined, check)).toHaveLength(1);
});
