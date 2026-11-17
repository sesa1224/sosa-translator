import { screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { fakeApi, openFakeWith, previewFake, row2, sampleSummary, updateFake, type FakeApi } from './fakeApi';

vi.mock('../../src/renderer/preview/fontFace', () => ({ ensureFontFace: vi.fn(async () => 'fake-family'), fontFamilyName: () => 'fake-family' }));
vi.mock('../../src/renderer/preview/palette', async (orig) => {
  const real = await orig<typeof import('../../src/renderer/preview/palette')>();
  return { ...real, paletteFromSkin: vi.fn(async () => real.DEFAULT_PALETTE) };
});

/** The button's one decorative icon: a 16px svg hidden from screen readers. */
function icon(el: HTMLElement): SVGElement {
  const svgs = el.querySelectorAll('svg');
  expect(svgs).toHaveLength(1);
  const svg = svgs[0];
  expect(svg).toHaveAttribute('aria-hidden', 'true');
  expect(svg).toHaveAttribute('width', '16');
  return svg;
}

let api: FakeApi;
beforeEach(() => {
  api = fakeApi();
  const pv = previewFake(api);
  pv.state = { ...pv.state, settings: { fontPath: 'C:/fonts/game.ttf', fontName: '게임체', overrides: {} } };
  pv.layout = () => ({ lines: [{ runs: [{ type: 'text', text: '가나다', color: 0, size: 26 }], width: 78, overflow: 0 }], maxWidth: 78, available: 768, lineOverflow: 0, missingGlyphs: 0 });
});

test('왼쪽 메뉴의 모든 항목에 아이콘이 있고, 단추 이름은 글자 그대로다', async () => {
  updateFake(api).summary = sampleSummary();
  await openFakeWith(api);
  const nav = screen.getByRole('navigation', { name: '작업 메뉴' });
  await within(nav).findByRole('button', { name: '업데이트 결과' });
  const items = [...nav.querySelectorAll<HTMLElement>('.nav-btn')];
  expect(items.map((b) => b.querySelector('span')!.textContent)).toEqual(
    ['텍스트', '용어집', '번역 지침', '설정', '판단 필요', '이벤트', '수정 내역', '이미지', '빌드 기록', '작업 기록', '업데이트 결과']);
  const kinds = new Set(items.map((b) => icon(b).getAttribute('class')));
  // A different picture for each item.
  expect(kinds.size).toBe(items.length);
  expect(within(nav).getByRole('button', { name: '설정' })).toBeVisible();
});

test('타이틀바의 게임 실행·패치 빌드와 무대의 단추에도 아이콘', async () => {
  const user = await openFakeWith(api, { select: row2.id });
  const bar = screen.getByRole('banner');
  icon(within(bar).getByRole('button', { name: '게임 실행' }));
  icon(within(bar).getByRole('button', { name: '패치 빌드' }));
  const big = await screen.findByRole('button', { name: '크게 보며 고치기' });
  icon(big);
  await user.click(big);
  const stage = within(screen.getByRole('region', { name: '크게 보며 고치기' }));
  for (const name of ['이전 줄', '다음 줄', '작게']) icon(stage.getByRole('button', { name }));
});
