import { expect, test } from 'vitest';
import { defaultGlossary, termId } from '../../src/core/glossary/store.js';
import type { Glossary } from '../../src/core/glossary/types.js';
import { SPEAKER_PRESETS } from '../../src/core/text/speaker.js';
import type { TextUnit, TranslationEntry, UnitKind } from '../../src/core/types.js';
import { buildTranslatePrompt, planBatches, TRANSLATE_SCHEMA } from '../../src/main/translate/batches.js';

const bracket = SPEAKER_PRESETS.find(p => p.id === 'bracket')!.pattern;
const U = (id: string, kind: UnitKind, source: string, file: string, needsDecision = false): TextUnit =>
  ({ id, kind, source, needsDecision, refs: [{ type: 'value', file, path: [id] }] });
const units: TextUnit[] = [
  U('choice', 'choice', 'いいよ', 'data/Map001.json'),
  U('done', 'dialogue', '【アーテル】\n「もちろん無料で」', 'data/Map001.json'),
  U('eh', 'dialogue', '【アーテル】\n「え？」', 'data/Map001.json'),
  U('cmd', 'plugin-command', 'ShowRecord 記録', 'data/Map001.json', true),
  U('herb', 'dialogue', '【アーテル】\n「月光草を集めて」', 'data/Map001.json'),
  U('item', 'db', '月光草', 'data/Items.json'),
  U('desc', 'db', '夜に光る草。\\C[2]貴重\\C[0]だ', 'data/Items.json'),
];
const needsDecisionId = 'cmd';
const translatedId = 'done';
const someId = 'item';
const entries: Record<string, TranslationEntry> = { done: { target: '【아텔】\n「물론 공짜로」', status: 'needs-review', updatedAt: 't' } };
const entryOf = (id: string): TranslationEntry => entries[id] ?? { target: null, status: 'untranslated', updatedAt: '' };
const g: Glossary = {
  ...defaultGlossary(),
  terms: [
    { id: termId('月光草'), source: '月光草', target: '월광초', category: 'term', status: 'confirmed', candidates: [] },
    { id: termId('ギルド'), source: 'ギルド', target: '길드', category: 'term', status: 'confirmed', candidates: [] },
    { id: termId('アーテル'), source: 'アーテル', target: '아텔', category: 'name', status: 'confirmed', candidates: [] },
  ],
  characters: [{ id: 'a', source: 'アーテル', target: '아텔', speech: '차분한 반말' }, { id: 'b', source: 'ギア', target: '기어', speech: '거친 말투' }],
};
const gs: Glossary = { ...g, rules: { ...g.rules, speakerPattern: bracket } };
const batch = planBatches(units, entryOf, gs, { ids: ['herb'] })[0];

test('파일과 크기로 나눈다', () => {
  const b = planBatches(units, entryOf, g, { maxItems: 2 });
  expect(b.map(x => [x.file, x.items.length])).toEqual([['data/Map001.json', 2], ['data/Map001.json', 1], ['data/Items.json', 2]]);
  expect(b[0].label).toBe('맵1 (1/2)'); expect(b.flatMap(x => x.items).some(i => i.id === needsDecisionId)).toBe(false);
  expect(planBatches(units, entryOf, g, { maxChars: 10 }).every(x => x.items.length === 1)).toBe(true);
});
test('화자 줄을 떼고 앞 문맥을 붙인다', () => {
  const b = planBatches(units, entryOf, { ...g, rules: { ...g.rules, speakerPattern: bracket } }, { maxItems: 1 });
  expect(b[1].items[0]).toMatchObject({ speaker: 'アーテル', speakerLine: '【アーテル】', text: '「え？」' });
  expect(b[1].context).toEqual([{ speaker: 'アーテル', source: '「もちろん無料で」', target: '「물론 공짜로」' }]);
});
test('이미 번역된 것은 빼고, ids 로 좁힌다', () => {
  expect(planBatches(units, entryOf, g).flatMap(x => x.items).some(i => i.id === translatedId)).toBe(false);
  expect(planBatches(units, entryOf, g, { ids: [someId] }).flatMap(x => x.items).map(i => i.id)).toEqual([someId]);
});
test('프롬프트에는 그 묶음의 용어와 인물만', () => {
  const p = buildTranslatePrompt(batch, g); const u = JSON.parse(p.user);
  expect(u.terms).toEqual([{ source: '月光草', target: '월광초' }]); expect(u.characters.map((c: any) => c.name)).toEqual(['アーテル']);
  expect(u.items[0]).toEqual({ i: 0, kind: 'dialogue', speaker: 'アーテル', text: '「月光草を集めて」' });
  expect(p.system).toContain(g.styleGuide); expect(p.system).toContain('declined');
});

// Extra coverage beyond the plan's assertions.
test('묶음의 나머지 모양', () => {
  const b = planBatches(units, entryOf, gs);
  expect(b.map(x => x.label)).toEqual(['맵1 (1/1)', 'Items (1/1)']);
  expect(b[0].items.map(i => i.i)).toEqual([0, 1, 2]);
  expect(b[0].context).toEqual([]);
  expect(b[1].items[1]).toEqual({ i: 1, id: 'desc', kind: 'db', speaker: null, speakerLine: null, text: '夜に光る草。\\C[2]貴重\\C[0]だ' });
  expect(planBatches(units, entryOf, g, { includeStatuses: ['needs-review'] }).flatMap(x => x.items).map(i => i.id)).toEqual(['done']);
  const p = buildTranslatePrompt(batch, { ...gs, rules: { ...gs.rules, maxLineWidthChars: 28 } });
  expect(p.system).toContain('28'); expect(JSON.parse(p.user).characters[0]).toEqual({ name: 'アーテル', target: '아텔', speech: '차분한 반말' });
  expect(JSON.stringify(TRANSLATE_SCHEMA)).toContain('newTerms');
});
