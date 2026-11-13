import { expect, test } from 'vitest';
import { carryTranslations, changedWords } from '../../src/core/update/carry.js';
import { diffUnits } from '../../src/core/update/diff.js';
import { mergeUnits } from '../../src/core/extract/index.js';
import type { RawUnit } from '../../src/core/extract/events.js';
import type { Decisions } from '../../src/core/decisions/types.js';
import { SPEAKER_PRESETS } from '../../src/core/text/speaker.js';
import type { PathSeg, TextUnit, TranslationEntry } from '../../src/core/types.js';

const P: PathSeg[] = ['events', 1, 'pages', 0, 'list'];
const line = (source: string, start: number): RawUnit => ({ kind: 'dialogue', source, needsDecision: false, ref: { type: 'lines', file: 'data/Map001.json', listPath: P, start, count: 1, code: 401 } });
const units = (raw: RawUnit[]): TextUnit[] => mergeUnits(raw);
const tr = (target: string, status: TranslationEntry['status'] = 'approved'): TranslationEntry => ({ target, status, updatedAt: '2026-01-01T00:00:00.000Z' });
const BRACKET = SPEAKER_PRESETS.find((p) => p.id === 'bracket')!.pattern;

function run(oldRaw: RawUnit[], newRaw: RawUnit[], entries: Record<string, TranslationEntry>, decisions: Decisions = {}, speakerPattern: string | null = null) {
  const oldUnits = units(oldRaw);
  const newUnits = units(newRaw);
  const diff = diffUnits(oldUnits, newUnits);
  return { oldUnits, newUnits, diff, r: carryTranslations({ diff, oldUnits, newUnits, entries, decisions, fromVersion: 'v1', speakerPattern }) };
}

test('바뀐 문장의 새 항목에 previous 가 붙고 번역은 없다', () => {
  const o = units([line('こんな夜に来るなんて', 1)]);
  const { newUnits, r } = run([line('こんな夜に来るなんて', 1)], [line('こんな夜更けに来るなんて', 1)], { [o[0].id]: tr('이런 밤에 오다니') });
  const e = r.entries[newUnits[0].id];
  expect(e.previous).toEqual({ source: 'こんな夜に来るなんて', target: '이런 밤에 오다니', version: 'v1' });
  expect(e.target).toBeNull();
  expect(e.status).toBe('untranslated');
  expect(e.carried).toBeUndefined();
  expect(r.carried).toBe(0);
  expect(r.entries[o[0].id].target).toBe('이런 밤에 오다니');
});

test('문장부호만 바뀌면 옛 번역을 미리 채워 검토 필요로 둔다', () => {
  const o = units([line('やった！', 6)]);
  const { newUnits, r } = run([line('やった！', 6)], [line('やった！！', 6)], { [o[0].id]: tr('해냈다!') });
  const e = r.entries[newUnits[0].id];
  expect(e).toMatchObject({ target: '해냈다!', status: 'needs-review', carried: true, previous: { source: 'やった！', target: '해냈다!', version: 'v1' } });
  expect(r.carried).toBe(1);
});

test('옛 번역이 없으면 미리 채우지 않고, 새 id 에 번역이 있으면 덮지 않는다', () => {
  const none = run([line('やった！', 6)], [line('やった！！', 6)], {});
  const e1 = none.r.entries[none.newUnits[0].id];
  expect(e1.target).toBeNull();
  expect(e1.carried).toBeUndefined();
  expect(none.r.carried).toBe(0);

  const o = units([line('やった！', 6)]);
  const n = units([line('やった！！', 6)]);
  const had = run([line('やった！', 6)], [line('やった！！', 6)], { [o[0].id]: tr('해냈다!'), [n[0].id]: tr('해냈어!!', 'approved') });
  const e2 = had.r.entries[n[0].id];
  expect(e2.target).toBe('해냈어!!');
  expect(e2.status).toBe('approved');
  expect(e2.carried).toBeUndefined();
  expect(e2.previous).toEqual({ source: 'やった！', target: '해냈다!', version: 'v1' });
});

test('화자 이름만 바뀌면 본문 번역을 옮기고 화자 줄은 새 원문으로 다시 만든다', () => {
  const oldS = '【アーテル】\nそれは本当なの？';
  const newS = '【アーテル（怒）】\nそれは本当なの？';
  const o = units([line(oldS, 1)]);
  const { newUnits, r } = run([line(oldS, 1)], [line(newS, 1)], { [o[0].id]: tr('【아텔】\n그게 정말이야?') }, {}, BRACKET);
  const e = r.entries[newUnits[0].id];
  expect(e).toMatchObject({ target: '【アーテル（怒）】\n그게 정말이야?', status: 'needs-review', carried: true });
  expect(r.carried).toBe(1);
});

test('화자 이름은 용어집에 있으면 그 번역으로', () => {
  const oldS = '【アーテル】\nそれは本当なの？';
  const newS = '【アーテル（怒）】\nそれは本当なの？';
  const oldUnits = units([line(oldS, 1)]);
  const newUnits = units([line(newS, 1)]);
  const r = carryTranslations({
    diff: diffUnits(oldUnits, newUnits), oldUnits, newUnits, entries: { [oldUnits[0].id]: tr('【아텔】\n그게 정말이야?') }, decisions: {}, fromVersion: 'v1', speakerPattern: BRACKET,
    glossary: { terms: [{ id: 't', source: 'アーテル（怒）', target: '아텔(화남)', category: 'name', status: 'confirmed', candidates: [] }], characters: [] },
  });
  expect(r.entries[newUnits[0].id].target).toBe('【아텔(화남)】\n그게 정말이야?');
});

test('moved: 번역과 unit 결정이 새 id 로 복사되고 옛 것도 남는다', () => {
  const oldUnits = units([line('一つ目', 1)]);
  const newUnits = units([line('二つ目', 1)]);
  const entries = { [oldUnits[0].id]: tr('첫째') };
  const decisions: Decisions = { [`unit:${oldUnits[0].id}`]: { translate: true, keep: { mode: 'whole' }, status: 'confirmed', by: 'user' } };
  const diff = { kept: [], added: [], removed: [], changed: [], moved: [{ oldId: oldUnits[0].id, newId: newUnits[0].id }] };
  const r = carryTranslations({ diff, oldUnits, newUnits, entries, decisions, fromVersion: 'v1', speakerPattern: null });
  expect(r.entries[newUnits[0].id].target).toBe('첫째');
  expect(r.entries[oldUnits[0].id].target).toBe('첫째');
  expect(r.decisions[`unit:${newUnits[0].id}`]).toEqual(decisions[`unit:${oldUnits[0].id}`]);
  expect(r.decisions[`unit:${oldUnits[0].id}`]).toBeDefined();
});

test('받은 entries 와 decisions 는 바뀌지 않는다', () => {
  const o = units([line('やった！', 6)]);
  const entries = { [o[0].id]: tr('해냈다!') };
  const before = JSON.stringify(entries);
  const decisions: Decisions = {};
  run([line('やった！', 6)], [line('やった！！', 6)], entries, decisions);
  expect(JSON.stringify(entries)).toBe(before);
  expect(decisions).toEqual({});
});

test('changedWords 는 바뀐 글자만 표시한다', () => {
  const w = changedWords('月光草を3本', '月光草を5本');
  expect(w.new.filter((p) => p.changed).map((p) => p.text)).toEqual(['5']);
  expect(w.old.filter((p) => p.changed).map((p) => p.text)).toEqual(['3']);
  expect(w.new.map((p) => p.text).join('')).toBe('月光草を5本');
  expect(w.new).toEqual([{ text: '月光草を', changed: false }, { text: '5', changed: true }, { text: '本', changed: false }]);
});
