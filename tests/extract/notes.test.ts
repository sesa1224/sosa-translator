import { expect, test } from 'vitest';
import { extractNotes, replaceNoteValue } from '../../src/core/extract/notes.js';
import { extractFromDataFile } from '../../src/core/extract/database.js';

test('<태그:값> 의 일본어 값만', () => {
  const note = '<SG説明:夜に光る草>\n<price:100>\n<SG説明:二つ目>';
  const units = extractNotes(note, 'data/Items.json', [1, 'note']);
  expect(units).toEqual([
    { kind: 'note', source: '夜に光る草', needsDecision: true, decisionKey: 'note:Items:SG説明', ref: { type: 'note', file: 'data/Items.json', path: [1, 'note'], tag: 'SG説明', index: 0 } },
    { kind: 'note', source: '二つ目', needsDecision: true, decisionKey: 'note:Items:SG説明', ref: { type: 'note', file: 'data/Items.json', path: [1, 'note'], tag: 'SG説明', index: 1 } },
  ]);
});

test('여러 줄 태그와 값 없는 태그, 태그 밖의 글', () => {
  const note = '前置き\n<説明>\n一行目\n二行目\n</説明>\n<封印>\n<名前:アイ>';
  const units = extractNotes(note, 'data/Skills.json', [3, 'note']);
  expect(units.map((u) => [u.source, (u.ref as { tag: string }).tag])).toEqual([['一行目\n二行目', '説明'], ['アイ', '名前']]);
});

test('replaceNoteValue: 그 자리만 바꾸고 $ 는 글자 그대로', () => {
  const note = '<SG説明:夜に光る草>\n<price:100>\n<SG説明:二つ目>';
  expect(replaceNoteValue(note, 'SG説明', 1, '두 번째 $1 $&')).toBe('<SG説明:夜に光る草>\n<price:100>\n<SG説明:두 번째 $1 $&>');
  expect(replaceNoteValue(note, 'SG説明', 0, '밤에 빛나는 풀')).toBe('<SG説明:밤에 빛나는 풀>\n<price:100>\n<SG説明:二つ目>');
  const multi = 'a\n<説明>\n一行目\n二行目\n</説明>\nb';
  expect(replaceNoteValue(multi, '説明', 0, '첫 줄\n둘째 줄')).toBe('a\n<説明>\n첫 줄\n둘째 줄\n</説明>\nb');
});

test('빈 글이나 문자열이 아닌 note', () => {
  expect(extractNotes('', 'data/Items.json', [1, 'note'])).toEqual([]);
  expect(extractNotes(undefined as unknown as string, 'data/Items.json', [1, 'note'])).toEqual([]);
  expect(extractNotes(5 as unknown as string, 'data/Items.json', [1, 'note'])).toEqual([]);
});

test('데이터 파일과 맵 이벤트의 note 를 추출한다', () => {
  const items = extractFromDataFile('Items.json', [null, { id: 1, name: 'a', description: '', note: '<SG説明:夜に光る草>' }]);
  expect(items.map((u) => [u.kind, u.source, u.decisionKey])).toEqual([['note', '夜に光る草', 'note:Items:SG説明']]);
  const map = extractFromDataFile('Map002.json', { displayName: '', events: [null, { id: 1, note: '<名札:村人>', pages: [] }] });
  expect(map.map((u) => [u.source, u.decisionKey, u.ref])).toEqual([
    ['村人', 'note:Map:名札', { type: 'note', file: 'data/Map002.json', path: ['events', 1, 'note'], tag: '名札', index: 0 }]]);
});
