import { expect, test } from 'vitest';
import { layoutMessage } from '../../src/core/preview/layout.js';
import { DEFAULT_METRICS } from '../../src/core/preview/metrics.js';
import { rewrapText, type RewrapWindow } from '../../src/core/preview/rewrap.js';
import type { Measure, PreviewContext } from '../../src/core/preview/types.js';

/** Every character (a space too) is fontSize wide: with size 10 and width 100 a line holds 10 characters. */
const measure: Measure = (text, size) => ({ width: [...text].length * size, missing: 0 });
const ctx: PreviewContext = { actorNames: {}, variables: {}, currencyUnit: 'G', partyNames: {} };

function win(o: { maxLines?: number; withFace?: boolean; width?: number; speakerPattern?: string | null } = {}): RewrapWindow {
  const maxLines = o.maxLines ?? 3;
  const m = { ...DEFAULT_METRICS.MV, fontSize: 10, maxLines, faceIndent: 40 };
  return {
    layout: (t) => layoutMessage(t, m, measure, ctx, { withFace: o.withFace ?? false, width: o.width ?? 100 }),
    maxLines,
    speakerPattern: o.speakerPattern ?? null,
  };
}

/** The characters apart from line breaks and spaces (what a rewrap must keep). */
const kept = (s: string) => s.replace(/[ \n]/g, '');

test('이미 맞는 글은 같은 문자열 그대로', () => {
  const text = '가나다 라마바\n사아';
  const r = rewrapText(text, win());
  expect(r).toEqual({ ok: true, text, changed: false });
});

test('넘치는 줄만 나누고 다른 줄의 줄바꿈은 그대로', () => {
  const r = rewrapText('가가가 나나나 다다다 라라라\n짧다', win());
  expect(r).toEqual({ ok: true, text: '가가가 나나나\n다다다 라라라\n짧다', changed: true });
});

test('쉼표·마침표 같은 문장부호 뒤의 빈칸을 먼저 고른다', () => {
  // The last space that fits is after 바사 (9 characters); the comma after 마 (6) is preferred.
  expect(rewrapText('가나다라마, 바사 아자차', win()).text).toBe('가나다라마,\n바사 아자차');
  expect(rewrapText('가나다라마… 바사 아자차', win()).text).toBe('가나다라마…\n바사 아자차');
  // A comma too early in the line (under half the width) is not worth a short line.
  expect(rewrapText('가나, 다라마바사 아자차카', win()).text).toBe('가나, 다라마바사\n아자차카');
});

test('제어문자 안과 이름 칸 코드 안은 끊지 않는다', () => {
  // The only spaces are inside \C[ 2] and \n<리나 언니>: no place to break.
  const text = '\\n<리나 언니>가나다라마바사아자\\C[ 2]차카타';
  expect(rewrapText(text, win())).toEqual({ ok: false, text, reason: 'no-break' });
  // A code takes no room, and the line is broken outside it.
  expect(rewrapText('\\C[2]가나다라마\\C[0] 바사아자차 카', win({ maxLines: 3 })).text).toBe('\\C[2]가나다라마\\C[0]\n바사아자차 카');
});

test('화자 줄은 끊지 않고 첫 줄로 그대로 둔다', () => {
  const w = win({ speakerPattern: '^【(.+?)】$', maxLines: 3 });
  expect(rewrapText('【리나】\n가나다 라마바 사아자 차카', w)).toEqual({ ok: true, text: '【리나】\n가나다 라마바\n사아자 차카', changed: true });
  // Flowing the whole text again leaves the speaker line out of it.
  expect(rewrapText('【리나】\n가나\n다라 마바 사아\n자차', w).text).toBe('【리나】\n가나 다라 마바\n사아 자차');
});

test('마지막 줄에 3자 이하만 남는 나눔은 피한다', () => {
  expect(rewrapText('가나다라 마바사아 자', win()).text).toBe('가나다라\n마바사아 자');
  // Punctuation does not count: "아자차." is three characters.
  expect(rewrapText('가나다 라마바사 아자차.', win()).text).toBe('가나다\n라마바사 아자차.');
});

test('나눈 결과가 줄 수를 넘으면 전체를 이어 다시 흘려 넣는다', () => {
  const text = '가나다 라마바 사아자 차카타\n파하 가나\n다라';
  const r = rewrapText(text, win({ maxLines: 3 }));
  expect(r.ok).toBe(true);
  expect(r.text.split('\n')).toHaveLength(3);
  expect(r.text).toBe('가나다 라마바\n사아자 차카타 파하\n가나 다라');
  expect(kept(r.text)).toBe(kept(text));
});

test('넘침이 줄 수뿐이어도 다시 흘려 넣는다', () => {
  expect(rewrapText('가나\n다라\n마바\n사아', win({ maxLines: 3 })).text).toBe('가나 다라\n마바 사아');
});

test('다시 흘려도 줄 수를 넘으면 고치지 않는다', () => {
  const text = '가나다 라마바 사아자 차카타 파하가 나다라 마바사 아자차';
  expect(rewrapText(text, win({ maxLines: 2 }))).toEqual({ ok: false, text, reason: 'too-many-lines' });
});

test('빈칸이 없으면 고치지 않는다', () => {
  const text = '가나다라마바사아자차카타파하';
  expect(rewrapText(text, win())).toEqual({ ok: false, text, reason: 'no-break' });
});

test('얼굴 그림이 있으면 더 일찍 나눈다', () => {
  // 100 - 40 for the face: 6 characters a line.
  const text = '가나다 라마바 사아';
  expect(rewrapText(text, win()).text).toBe(text);   // fits without a face
  expect(rewrapText(text, win({ withFace: true })).text).toBe('가나다\n라마바 사아');
});

test('줄바꿈과 그 자리 빈칸을 뺀 글자는 언제나 같다', () => {
  const words = ['가', '나다', '라마바', '사아자차', '카타,', '파하…', '\\C[2]빨강\\C[0]', '\\V[3]', '♡', '!?'];
  let seed = 7;
  const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  for (let i = 0; i < 300; i++) {
    const parts: string[] = [];
    const count = 3 + rand(14);
    for (let k = 0; k < count; k++) parts.push(words[rand(words.length)] + (rand(5) === 0 ? '\n' : ' '));
    const text = parts.join('').trim();
    const r = rewrapText(text, win({ maxLines: 2 + rand(3), withFace: rand(2) === 0 }));
    expect(kept(r.text)).toBe(kept(text));
    // Only spaces and line breaks move: every other character stays in order.
    if (!r.ok) expect(r.text).toBe(text);
  }
});
