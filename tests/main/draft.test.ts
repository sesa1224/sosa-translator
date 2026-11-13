import { expect, test } from 'vitest';
import { defaultGlossary, termId } from '../../src/core/glossary/store.js';
import { SPEAKER_PRESETS } from '../../src/core/text/speaker.js';
import type { TextUnit, UnitKind } from '../../src/core/types.js';
import { buildDraftPrompt, DRAFT_SCHEMA, isDraftResult, mergeDraft } from '../../src/main/translate/draft.js';
import { collectMaterial } from '../../src/main/translate/material.js';

const bracket = SPEAKER_PRESETS.find(p => p.id === 'bracket')!.pattern;
let n = 0;
const U = (kind: UnitKind, source: string, file = 'data/Map001.json', extra: Partial<TextUnit> = {}): TextUnit =>
  ({ id: `u${n++}`, kind, source, needsDecision: false, refs: [{ type: 'value', file, path: [n] }], ...extra });
const units: TextUnit[] = [
  U('db', 'アーテル', 'data/Actors.json', { refs: [{ type: 'value', file: 'data/Actors.json', path: [1, 'name'] }] }),
  U('db', 'ギア', 'data/Actors.json', { refs: [{ type: 'value', file: 'data/Actors.json', path: [2, 'name'] }] }),
  U('db', '見習いの騎士', 'data/Actors.json', { refs: [{ type: 'value', file: 'data/Actors.json', path: [1, 'profile'] }] }),
  U('dialogue', '\\C[4]【アーテル】\\C[0]\n「ギルドの依頼はもちろん無料で受けるわ」'),
  U('dialogue', '【アーテル】\n「ギルドに行くなら、私も一緒に行くわよ」'),
  U('dialogue', '【アーテル】\n「あっ…ぐちゅぐちゅって音がする…」'),
  U('dialogue', '【ギア】\n「ふん、ギルドの連中なんか信用できるか」'),
  U('dialogue', 'ぐちゅぐちゅと湿った音が部屋に響いた。'),
  U('dialogue', '夜のギルドは静まり返っていた。'),
  U('system', 'たたかう', 'data/System.json'),
  U('plugin-command', 'ShowRecord ギルドギルドギルド', 'data/Map001.json', { needsDecision: true }),
];

test('자료 모으기', () => {
  const m = collectMaterial(units, bracket);
  expect(m.names[0]).toEqual({ name: 'アーテル', count: 3 }); expect(m.sfx.map(s => s.text)).toContain('ぐちゅぐちゅ');
  expect(m.properNouns.some(p => p.text === 'アーテル')).toBe(false); expect(m.properNouns.map(p => p.text)).toContain('ギルド');
  expect(m.samples[0]).toMatchObject({ speaker: 'アーテル' }); expect(m.samples[0].lines.every(l => !l.includes('【'))).toBe(true);
  expect(m.menuTerms).toContain('たたかう');
});
test('초안 합치기', () => {
  const g = defaultGlossary(); g.terms.push({ id: termId('ギルド'), source: 'ギルド', target: '길드', category: 'term', status: 'confirmed', candidates: [] });
  const out = mergeDraft(g, { terms: [
    { source: 'ギルド', category: 'term', candidates: [{ target: '조합', reason: 'x' }] },
    { source: '乙女', category: 'name', candidates: [{ target: '오토메', reason: '이름' }, { target: '처녀', reason: '일반 명사' }] },
    { source: 'ぐちゅぐちゅ', category: 'sfx', candidates: [{ target: '찌걱찌걱', reason: '' }] } ],
    characters: [{ source: 'アーテル', target: '아텔', speech: '차분한 반말' }], styleNotes: '기사 학원물. 건조한 문체.' }, bracket);
  expect(out.terms.find(t => t.source === 'ギルド')!.target).toBe('길드');
  expect(out.terms.find(t => t.source === '乙女')).toMatchObject({ status: 'provisional', target: '오토메' });
  expect(out.terms.find(t => t.source === 'ぐちゅぐちゅ')).toMatchObject({ status: 'confirmed', category: 'sfx' });
  expect(out.styleGuide).toMatch(/## 이 게임의 말투\n기사 학원물/); expect(out.rules.speakerPattern).toBe(bracket); expect(out.confirmedAt).toBeNull();
  expect(mergeDraft(out, { terms: [], characters: [], styleNotes: '다시' }, null).styleGuide.match(/## 이 게임의 말투/g)).toHaveLength(1);
});
const m = collectMaterial(units, bracket);
test('프롬프트', () => { const p = buildDraftPrompt(m, 'GUIDE'); expect(p.system).toContain('GUIDE'); expect(JSON.parse(p.user).names[0].name).toBe('アーテル'); });

// Extra coverage beyond the plan's assertions.
test('자료의 나머지', () => {
  expect(m.names).toEqual([{ name: 'アーテル', count: 3 }, { name: 'ギア', count: 1 }]);
  expect(m.narrationSamples).toEqual(['ぐちゅぐちゅと湿った音が部屋に響いた。', '夜のギルドは静まり返っていた。']);
  expect(m.samples[0].lines[0]).toBe('「ギルドの依頼はもちろん無料で受けるわ」');
  expect(m.properNouns.find(p => p.text === 'ギルド')!.count).toBe(4);   // 판단 필요 항목은 세지 않는다
});
test('초안 결과 검사와 지침 다시 쓰기', () => {
  expect(isDraftResult({ terms: [], characters: [], styleNotes: '' })).toBe(true);
  expect(isDraftResult({ terms: [{ source: 'a', category: 'bad', candidates: [] }], characters: [], styleNotes: '' })).toBe(false);
  expect(JSON.stringify(DRAFT_SCHEMA)).toContain('styleNotes');
  const g = mergeDraft(defaultGlossary(), { terms: [], characters: [{ source: 'ギア', target: '기어', speech: '거친 말투' }], styleNotes: '첫째' }, null);
  const g2 = mergeDraft(g, { terms: [], characters: [{ source: 'ギア', target: '바뀜', speech: '' }], styleNotes: '둘째' }, null);
  expect(g2.styleGuide).toContain('둘째'); expect(g2.styleGuide).not.toContain('첫째'); expect(g2.characters).toHaveLength(1); expect(g2.characters[0].target).toBe('기어');
  expect(g2.rules.speakerPattern).toBeNull();
  const p = buildDraftPrompt(m, 'GUIDE'); expect(p.system).toContain('후보'); expect(p.system).toContain('styleNotes');
});
