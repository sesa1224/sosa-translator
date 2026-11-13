import { expect, test } from 'vitest';
import { layoutRegionText, sampleBorderColor } from '../../src/core/images/layoutText.js';
import { normalizeRegion } from '../../src/core/images/store.js';
import type { Region } from '../../src/core/images/types.js';

const measure = (t: string) => [...t].length * 10;
const BIG = { width: 1000, height: 1000 };

function region(p: Partial<Region> & { text: string }, rect = { x: 10, y: 20, w: 100, h: 100 }): Region {
  return normalizeRegion({ rect, ...p }, BIG);
}

test('한 줄에 들어가면 한 줄, 가운데 정렬은 영역 가운데', () => {
  const r = layoutRegionText(region({ text: '가나다라마' }), measure);
  expect(r.lines).toHaveLength(1);
  expect(r.lines[0]).toMatchObject({ text: '가나다라마', x: 10 + 50, width: 50 });
  expect(r.overflowX).toBe(false);
  expect(r.overflowY).toBe(false);
});

test('폭을 넘으면 글자 단위로 나눈다', () => {
  const r = layoutRegionText(region({ text: '가나다라마바사아자차카타' }), measure);
  expect(r.lines.map((l) => l.text)).toEqual(['가나다라마바사아자차', '카타']);
});

test('닫는 문장부호는 줄 맨 앞에 오지 않고 앞 줄에 붙는다', () => {
  const r = layoutRegionText(region({ text: '안녕하세요, 반갑습니다.' }, { x: 0, y: 0, w: 50, h: 100 }), measure);
  expect(r.lines.map((l) => l.text)).toEqual(['안녕하세요,', '반갑습니다.']);
  const r2 = layoutRegionText(region({ text: '가나다라마.' }, { x: 0, y: 0, w: 50, h: 100 }), measure);
  expect(r2.lines.map((l) => l.text)).toEqual(['가나다라마.']);
});

test('공백에서 나누고 줄 끝 공백은 버린다', () => {
  const r = layoutRegionText(region({ text: 'ab cd ef' }, { x: 0, y: 0, w: 50, h: 100 }), measure);
  expect(r.lines.map((l) => l.text)).toEqual(['ab cd', 'ef']);
  const r2 = layoutRegionText(region({ text: 'ab cd ef' }, { x: 0, y: 0, w: 30, h: 100 }), measure);
  expect(r2.lines.map((l) => l.text)).toEqual(['ab', 'cd', 'ef']);
});

test('줄바꿈과 세로 가운데', () => {
  const r = layoutRegionText(region({ text: '첫\n둘', valign: 'middle', size: 20, lineHeight: 1.5 }, { x: 0, y: 7, w: 100, h: 100 }), measure);
  expect(r.lineHeightPx).toBe(30);
  expect(r.lines.map((l) => [l.text, l.y])).toEqual([['첫', 7 + 35], ['둘', 7 + 65]]);
  const top = layoutRegionText(region({ text: '첫', valign: 'top', size: 20, lineHeight: 1.5 }, { x: 0, y: 7, w: 100, h: 100 }), measure);
  expect(top.lines[0].y).toBe(7 + 15);
  const bottom = layoutRegionText(region({ text: '첫', valign: 'bottom', size: 20, lineHeight: 1.5 }, { x: 0, y: 7, w: 100, h: 100 }), measure);
  expect(bottom.lines[0].y).toBe(7 + 85);
});

test('정렬', () => {
  expect(layoutRegionText(region({ text: '가', align: 'right' }), measure).lines[0].x).toBe(10 + 100);
  expect(layoutRegionText(region({ text: '가', align: 'left' }), measure).lines[0].x).toBe(10);
});

test('넘침', () => {
  const tall = layoutRegionText(region({ text: '1\n2\n3\n4\n5', size: 20, lineHeight: 1 }, { x: 0, y: 0, w: 100, h: 60 }), measure);
  expect(tall.overflowY).toBe(true);
  const wide = layoutRegionText(region({ text: '가' }, { x: 0, y: 0, w: 5, h: 100 }), measure);
  expect(wide.overflowX).toBe(true);
  expect(layoutRegionText(region({ text: '' }), measure).lines).toEqual([]);
});

function picture(w: number, h: number, color: (x: number, y: number) => number[]): Uint8ClampedArray {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) a.set(color(x, y), (y * w + x) * 4);
  return a;
}

test('sampleBorderColor', () => {
  const red = picture(10, 10, () => [255, 0, 0, 255]);
  expect(sampleBorderColor(red, 10, 10, { x: 3, y: 3, w: 4, h: 4 })).toBe('#ff0000ff');
  // Outside the 4×4 corner area is green, inside red: only the right and bottom bands count.
  const corner = picture(10, 10, (x, y) => (x >= 4 || y >= 4 ? [0, 255, 0, 255] : [255, 0, 0, 255]));
  expect(sampleBorderColor(corner, 10, 10, { x: 0, y: 0, w: 4, h: 4 })).toBe('#00ff00ff');
  // The whole picture: no band outside, so the inner edge is used.
  expect(sampleBorderColor(red, 10, 10, { x: 0, y: 0, w: 10, h: 10 })).toBe('#ff0000ff');
});
