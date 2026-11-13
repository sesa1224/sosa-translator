import { screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Layout } from '../../src/shared/api';
import { useApp } from '../../src/renderer/state';
import { fakeApi, MZ_METRICS, openFakeWith, previewFake, row2, type FakeApi } from './fakeApi';

// jsdom has no FontFace and no canvas.
vi.mock('../../src/renderer/preview/fontFace', () => ({ ensureFontFace: vi.fn(async () => 'fake-family'), fontFamilyName: () => 'fake-family' }));
vi.mock('../../src/renderer/preview/palette', async (orig) => {
  const real = await orig<typeof import('../../src/renderer/preview/palette')>();
  return { ...real, paletteFromSkin: vi.fn(async () => real.DEFAULT_PALETTE) };
});

const NOTE = '프로그램이 흉내 내어 그린 화면이에요. 실제 확인은 게임에서 해요.';
const text = (t: string, color = 0, size = 26) => ({ type: 'text' as const, text: t, color, size });

function layout(p: Partial<Layout> = {}): Layout {
  return { lines: [{ runs: [text('가나다')], width: 78, overflow: 0 }], maxWidth: 78, available: 768, lineOverflow: 0, missingGlyphs: 0, ...p };
}

let api: FakeApi;
beforeEach(() => {
  api = fakeApi();
  const pv = previewFake(api);
  pv.state = { ...pv.state, settings: { fontPath: 'C:/fonts/game.ttf', fontName: '게임체', overrides: {} } };
});

const layoutCalls = () => api.calls.filter((c) => c[0] === 'preview.layout');

test('배치의 run 이 색과 크기대로 그려진다', async () => {
  previewFake(api).layout = () => layout({ lines: [{ runs: [text('빨강', 2), text('크게', 0, 38)], width: 128, overflow: 0 }], maxWidth: 128 });
  await openFakeWith(api, { select: row2.id });
  const red = await screen.findByText('빨강');
  expect(red).toHaveStyle({ color: '#ff784c', fontSize: '26px' });
  expect(screen.getByText('크게')).toHaveStyle({ color: '#ffffff', fontSize: '38px' });
  expect(screen.getByText('128 / 768px')).toBeVisible();
  expect(screen.getByText('1 / 4줄')).toBeVisible();
  expect(screen.getByText(NOTE)).toBeVisible();
});

test('넘친 줄이 있으면 폭 줄에 566 / 540px 과 경고 색, 넘침 표시', async () => {
  previewFake(api).layout = () => layout({ lines: [{ runs: [text('긴 줄')], width: 566, overflow: 26 }], maxWidth: 566, available: 540 });
  await openFakeWith(api, { select: row2.id });
  const w = await screen.findByText('566 / 540px');
  expect(w).toHaveClass('warn-text');
  expect(screen.getByTestId('overflow-mark')).toBeInTheDocument();
  expect(document.querySelector('.gp-bar-fill.over')).not.toBeNull();
  // available 540 < 768: the line is shown with a face picture
  expect(document.querySelector('.gp-face')).not.toBeNull();
});

test('5줄이면 5 / 4줄 과 다음 창으로 넘어가요', async () => {
  const lines = ['하나', '둘', '셋', '넷', '다섯'].map((t) => ({ runs: [text(t)], width: 52, overflow: 0 }));
  previewFake(api).layout = () => layout({ lines, maxWidth: 52, lineOverflow: 1 });
  await openFakeWith(api, { select: row2.id });
  expect(await screen.findByText('5 / 4줄')).toHaveClass('warn-text');
  expect(screen.getByText('다음 창으로 넘어가요')).toBeVisible();
  expect(screen.getByText('다섯').closest('.gp-rest')).not.toBeNull();
});

test('없는 글자가 있으면 알려 준다', async () => {
  previewFake(api).layout = () => layout({ missingGlyphs: 2 });
  await openFakeWith(api, { select: row2.id });
  expect(await screen.findByText('이 폰트에 없는 글자 2개')).toHaveClass('warn-text');
});

test('폰트가 없으면 폰트 고르기 버튼만 있고 미리보기 상자는 없다', async () => {
  const pv = previewFake(api);
  pv.state = { ...pv.state, settings: { fontPath: null, fontName: null, overrides: {} } };
  pv.layout = () => layout();
  const user = await openFakeWith(api, { select: row2.id });
  expect(await screen.findByText('게임 폰트를 고르면 실제 폭으로 볼 수 있어요')).toBeVisible();
  expect(screen.queryByRole('img', { name: '대사창 미리보기' })).toBeNull();
  expect(screen.getByText(NOTE)).toBeVisible();
  await user.click(screen.getByRole('button', { name: '폰트 고르기' }));
  expect(useApp.get().view).toBe('settings');
});

test('폰트 파일이 없어졌으면 알려 준다', async () => {
  const pv = previewFake(api);
  pv.state = { ...pv.state, fontMissing: true };
  await openFakeWith(api, { select: row2.id });
  expect(await screen.findByText('고른 폰트 파일을 찾을 수 없어요')).toBeVisible();
  expect(screen.queryByRole('img', { name: '대사창 미리보기' })).toBeNull();
});

test('편집 칸의 글을 바꾸면 150ms 뒤 한 번 그 글로 다시 배치한다', async () => {
  previewFake(api).layout = () => layout();
  const user = await openFakeWith(api, { select: row2.id });
  await screen.findByRole('img', { name: '대사창 미리보기' });
  const before = layoutCalls().length;
  expect(layoutCalls().at(-1)).toEqual(['preview.layout', row2.id, undefined]);
  await user.type(screen.getByLabelText('번역'), '월광초');
  expect(layoutCalls().length).toBe(before);
  await waitFor(() => expect(layoutCalls().length).toBe(before + 1));
  expect(layoutCalls().at(-1)).toEqual(['preview.layout', row2.id, '월광초']);
  await new Promise((r) => setTimeout(r, 300));
  expect(layoutCalls().length).toBe(before + 1);
});

test('preview:changed 가 오면 다시 배치한다', async () => {
  previewFake(api).layout = () => layout();
  await openFakeWith(api, { select: row2.id });
  await screen.findByRole('img', { name: '대사창 미리보기' });
  const before = layoutCalls().length;
  api.emit('preview:changed', { ...previewFake(api).state, metrics: { ...MZ_METRICS, boxWidth: 700 } });
  await waitFor(() => expect(layoutCalls().length).toBe(before + 1));
});
