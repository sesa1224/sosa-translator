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

const PROFILES = '<profile>\n基本の紹介\n</profile>\n<profile Switch: 740>\n鍵を拾った後\n二行目\n</profile>\n<profile Switch: 702>\n迷宮の奥で\n</profile>\n<CustomStat: ona=0>\n<price:100>';

test('조건 붙은 블록 <이름 조건>…</이름> 의 안쪽 글, 판단 키는 이름만', () => {
  const units = extractNotes(PROFILES, 'data/Actors.json', [1, 'note']);
  const ref = (tag: string) => ({ type: 'note', file: 'data/Actors.json', path: [1, 'note'], tag, index: 0 });
  expect(units).toEqual([
    { kind: 'note', source: '基本の紹介', needsDecision: true, decisionKey: 'note:Actors:profile', ref: ref('profile') },
    { kind: 'note', source: '鍵を拾った後\n二行目', needsDecision: true, decisionKey: 'note:Actors:profile', ref: ref('profile Switch: 740') },
    { kind: 'note', source: '迷宮の奥で', needsDecision: true, decisionKey: 'note:Actors:profile', ref: ref('profile Switch: 702') },
  ]);
});

test('기본 <profile> 과 <태그:값> 의 결과는 조건 블록이 있어도 그대로', () => {
  const plain = extractNotes('<profile>\n基本の紹介\n</profile>\n<名前:アイ>', 'data/Actors.json', [1, 'note']);
  const mixed = extractNotes('<profile>\n基本の紹介\n</profile>\n<profile Switch: 1>\n別\n</profile>\n<名前:アイ>', 'data/Actors.json', [1, 'note']);
  expect(mixed.filter((u) => (u.ref as { tag: string }).tag !== 'profile Switch: 1')).toEqual(plain);
});

test('같은 조건의 블록이 여러 개면 각자 자기 닫는 태그까지, index 로 가린다', () => {
  const note = '<msg if: a>\n一つ目\n</msg>\n<msg if: a>\n二つ目\n</msg>';
  expect(extractNotes(note, 'data/Items.json', [1, 'note']).map((u) => [u.source, (u.ref as { tag: string; index: number }).tag, (u.ref as { index: number }).index]))
    .toEqual([['一つ目', 'msg if: a', 0], ['二つ目', 'msg if: a', 1]]);
});

test('닫는 태그가 없는 <이름 조건> 은 건너뛰고 뒤의 블록을 삼키지 않는다, 값 태그는 값 태그로', () => {
  const note = '<profile Switch: 1>\n閉じない\n<profile Switch: 2>\n閉じる\n</profile>\n<CustomStat: ona=色>';
  expect(extractNotes(note, 'data/Actors.json', [1, 'note']).map((u) => [u.source, (u.ref as { tag: string }).tag])).toEqual([
    ['閉じる', 'profile Switch: 2'],
    [' ona=色', 'CustomStat'],
  ]);
  expect(extractNotes('<profile Switch: 3>\nabc\n</profile>', 'data/Actors.json', [1, 'note'])).toEqual([]);
});

test('replaceNoteValue: 조건 붙은 블록 하나만 바뀌고 나머지는 바이트 그대로', () => {
  const out = replaceNoteValue(PROFILES, 'profile Switch: 740', 0, '열쇠를 주운 뒤\n둘째 줄');
  expect(out).toBe(PROFILES.replace('鍵を拾った後\n二行目', '열쇠를 주운 뒤\n둘째 줄'));
  expect(replaceNoteValue(PROFILES, 'profile', 0, '기본')).toBe(PROFILES.replace('基本の紹介', '기본'));
  expect(replaceNoteValue(PROFILES, 'profile Switch: 999', 0, 'x')).toBe(PROFILES);
  const crlf = '<profile Switch: 7>\r\n夜\r\n</profile>';
  expect(replaceNoteValue(crlf, 'profile Switch: 7', 0, '밤')).toBe('<profile Switch: 7>\r\n밤\r\n</profile>');
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
