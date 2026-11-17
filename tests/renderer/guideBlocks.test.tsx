import { expect, test } from 'vitest';
import { codeSpans, guideLines, splitGuide } from '../../src/renderer/guideBlocks';

const TEXT = [
  '너는 번역한다.',
  '',
  '<번역 지침>',
  '## 기본 태도',
  '',
  '- 자연스러운 말투로 옮긴다.',
  '- 말높이: 관계로 정한다. `です` 라고 꼭 존댓말은 아니다.',
  '  · 맵1: 예외',
  '',
  '## 형식',
  '문단 한 줄.',
  '</번역 지침>',
  '',
  '## 출력',
  'JSON 으로 답한다.',
  '',
].join('\n');

test('제목에서 자르고, 이어 붙이면 원래 글 그대로', () => {
  const blocks = splitGuide(TEXT);
  expect(blocks.map((b) => [b.kind, b.title])).toEqual([['intro', '머리말'], ['section', '기본 태도'], ['section', '형식'], ['outro', '지침 밖의 글']]);
  expect(blocks.map((b) => b.text).join('')).toBe(TEXT);
  expect(TEXT.slice(blocks[1].at)).toMatch(/^## 기본 태도/);
  expect(blocks[1].line).toBe(3);
  // The program's part keeps its own "## " lines in one block.
  expect(blocks[3].text).toContain('## 출력');
});

test('머리말이 비면 그 묶음은 없다', () => {
  expect(splitGuide('## 하나\n글').map((b) => b.kind)).toEqual(['section']);
  expect(splitGuide('')).toEqual([]);
});

test('본문을 그릴 줄로: 규칙은 점 목록, 이름표는 따로, 꼬리표와 문단', () => {
  const [intro, first, second] = splitGuide(TEXT);
  expect(guideLines(intro)).toEqual([{ type: 'para', text: '너는 번역한다.' }, { type: 'gap' }, { type: 'tag', text: '<번역 지침>' }]);
  expect(guideLines(first)).toEqual([
    { type: 'bullet', depth: 0, key: null, text: '자연스러운 말투로 옮긴다.' },
    { type: 'bullet', depth: 0, key: '말높이', text: '관계로 정한다. `です` 라고 꼭 존댓말은 아니다.' },
    { type: 'bullet', depth: 1, key: '맵1', text: '예외' },
  ]);
  expect(guideLines(second)).toEqual([{ type: 'para', text: '문단 한 줄.' }]);
});

test('백틱 사이는 코드로', () => {
  expect(codeSpans('앞 `です` 뒤')).toEqual([{ code: false, text: '앞 ' }, { code: true, text: 'です' }, { code: false, text: ' 뒤' }]);
  expect(codeSpans('백틱 없음')).toEqual([{ code: false, text: '백틱 없음' }]);
});
