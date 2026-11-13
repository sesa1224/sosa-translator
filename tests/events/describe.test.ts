import { rm } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { describeCommand, describeList } from '../../src/core/events/describe.js';
import { emptyNames, loadNames, type NameTable } from '../../src/core/events/names.js';
import type { EventCommand } from '../../src/core/patches/types.js';
import { cleanupTempDirs } from '../helpers/fs.js';
import { miniMap } from '../helpers/miniGame.js';
import { setupProject } from '../helpers/project.js';

afterAll(cleanupTempDirs);

const names = (o: Partial<NameTable> = {}): NameTable => ({ ...emptyNames(), ...o });
const cmd = (code: number, parameters: unknown, indent = 0): EventCommand => ({ code, indent, parameters: parameters as unknown[] });

test('시험용 게임의 맵 이벤트를 풀어쓴다 (MZ)', () => {
  const list = miniMap('MZ').events[1]!.pages[0].list as EventCommand[];
  const lines = describeList(list, names());
  expect(lines.map((l) => l.text)).toEqual([
    '대사 [リナ] あれ？\\N[1]じゃない！ / こんな夜に来るなんて',
    '선택지: いいよ / また今度',
    '└ "いいよ" 를 고르면',
    '대사 [リナ] やった！',
    '└ "また今度" 를 고르면',
    '선택지 끝',
    '플러그인 커맨드: ShowRecord 記録',
  ]);
  expect(lines.map((l) => l.index)).toEqual([0, 3, 4, 5, 8, 10, 11]);
  expect(lines.map((l) => l.indent)).toEqual([0, 0, 0, 1, 0, 0, 0]);
  expect(lines.map((l) => l.code)).toEqual([101, 102, 402, 101, 402, 404, 356]);
});

test('스위치 조작', () => {
  const sw: string[] = [];
  sw[45] = '기록1 완료';
  expect(describeCommand(cmd(121, [45, 45, 0]), names({ switches: sw }))).toBe('스위치 45 [기록1 완료] = 켬');
  expect(describeCommand(cmd(121, [12, 14, 1]), names({ switches: sw }))).toBe('스위치 12~14 = 끔');
});

test('변수 조작', () => {
  const vars: string[] = [];
  vars[12] = '시간대';
  expect(describeCommand(cmd(122, [12, 12, 1, 0, 1]), names({ variables: vars }))).toBe('변수 12 [시간대] += 1');
  expect(describeCommand(cmd(122, [5, 5, 0, 1, 12]), names({ variables: vars }))).toBe('변수 5 = 변수 12 [시간대]');
  expect(describeCommand(cmd(122, [5, 5, 0, 2, 1, 6]), names())).toBe('변수 5 = 난수 1~6');
});

test('조건 분기', () => {
  expect(describeCommand(cmd(111, [1, 5, 0, 3, 1]), names())).toBe('만약 변수 5 ≥ 3 이면');
  expect(describeCommand(cmd(111, [0, 12, 0]), names())).toBe('만약 스위치 12 이 켜짐이면');
  expect(describeCommand(cmd(111, [2, 'A', 0]), names())).toBe('만약 셀프 스위치 A 가 켜짐이면');
  expect(describeCommand(cmd(111, [12, 'x > 1']), names())).toBe('만약 스크립트: x > 1');
  expect(describeCommand(cmd(111, [6, 1, 0]), names())).toBe('만약 (조건 종류 6)');
});

test('장소 이동', () => {
  expect(describeCommand(cmd(201, [0, 5, 12, 8, 0, 0]), names({ maps: { 5: '숲' } }))).toBe('장소 이동 맵 5 [숲] (12, 8)');
  expect(describeCommand(cmd(201, [1, 5, 12, 8, 0, 0]), names())).toBe('장소 이동 (변수로 지정)');
});

test('모르는 코드와 이상한 인자에서 예외가 없다', () => {
  expect(describeCommand(cmd(999, ['x', 1]), names())).toBe('코드 999 ["x",1]');
  expect(() => describeCommand(cmd(999, null), names())).not.toThrow();
  expect(() => describeCommand(cmd(121, 'oops'), names())).not.toThrow();
  expect(() => describeCommand(cmd(111, undefined), names())).not.toThrow();
  const long = describeCommand(cmd(999, ['가'.repeat(300)]), names());
  expect(long.endsWith('…')).toBe(true);
  expect(() => describeList([null as unknown as EventCommand, cmd(401, 5)], names())).not.toThrow();
});

test('이름이 빈 글이면 대괄호를 붙이지 않는다', () => {
  const sw: string[] = [];
  sw[3] = '';
  expect(describeCommand(cmd(121, [3, 3, 0]), names({ switches: sw }))).toBe('스위치 3 = 켬');
  expect(describeCommand(cmd(117, [4]), names())).toBe('커먼이벤트 4 실행');
});

test('그 밖의 풀어쓰기', () => {
  const n = names();
  expect(describeCommand(cmd(230, [60]), n)).toBe('기다리기 60프레임');
  expect(describeCommand(cmd(231, [1, '立ち絵']), n)).toBe('그림 표시 1번: 立ち絵');
  expect(describeCommand(cmd(235, [1]), n)).toBe('그림 지우기 1번');
  expect(describeCommand(cmd(250, [{ name: 'Cursor1' }]), n)).toBe('SE 재생: Cursor1');
  expect(describeCommand(cmd(123, ['A', 0]), n)).toBe('셀프 스위치 A = 켬');
  expect(describeCommand(cmd(357, ['Menu', 'SET', '目標', { destination: '北' }]), n)).toBe('플러그인 커맨드: Menu · SET { destination: 北 }');
  expect(describeCommand(cmd(221, []), n)).toBe('화면 페이드아웃');
  expect(describeCommand(cmd(118, ['a']), n)).toBe('라벨 "a"');
  expect(describeCommand(cmd(119, ['a']), n)).toBe('라벨 "a" 으로 이동');
  expect(describeCommand(cmd(125, [0, 0, 100]), n)).toBe('소지금 +100');
  expect(describeCommand(cmd(126, [3, 1, 0, 1]), n)).toBe('아이템 3 -1');
  expect(describeCommand(cmd(129, [1, 0, false]), n)).toBe('파티에 액터 1 넣기');
  const merged = describeList([cmd(355, ['a()']), cmd(655, ['b()']), cmd(357, ['P', 'C', '', {}]), cmd(657, ['x = 1'])], n);
  expect(merged.map((l) => l.text)).toEqual(['스크립트: a() / b()', '플러그인 커맨드: P · C {}']);
});

test('loadNames 가 원본 사본에서 이름을 읽고 없는 파일은 빈 목록이다', async () => {
  const { proj } = await setupProject();
  await rm(path.join(proj, 'original', 'v1', 'data', 'Enemies.json'));
  const n = await loadNames(proj);
  expect(n.actors[1]).toBe('リナ');
  expect(n.items[1]).toBe('月光草');
  expect(n.maps[1]).toBe('MAP001');
  expect(n.switches).toEqual([]);
  expect(n.enemies).toEqual([]);
});
