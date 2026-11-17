import { act, screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Layout } from '../../src/shared/api';
import { useApp } from '../../src/renderer/state';
import { fakeApi, openFakeWith, previewFake, row1, row2, type FakeApi } from './fakeApi';

// jsdom has no FontFace and no canvas.
vi.mock('../../src/renderer/preview/fontFace', () => ({ ensureFontFace: vi.fn(async () => 'fake-family'), fontFamilyName: () => 'fake-family' }));
vi.mock('../../src/renderer/preview/palette', async (orig) => {
  const real = await orig<typeof import('../../src/renderer/preview/palette')>();
  return { ...real, paletteFromSkin: vi.fn(async () => real.DEFAULT_PALETTE) };
});

const text = (t: string) => ({ type: 'text' as const, text: t, color: 0, size: 26 });
function layout(p: Partial<Layout> = {}): Layout {
  return { lines: [{ runs: [text('가나다')], width: 78, overflow: 0 }], maxWidth: 78, available: 768, lineOverflow: 0, missingGlyphs: 0, ...p };
}

let api: FakeApi;
beforeEach(() => {
  api = fakeApi();
  const pv = previewFake(api);
  pv.state = { ...pv.state, settings: { fontPath: 'C:/fonts/game.ttf', fontName: '게임체', overrides: {} } };
  pv.layout = () => layout();
});

const stage = () => screen.queryByRole('region', { name: '크게 보며 고치기' });

async function openBig() {
  const user = await openFakeWith(api, { select: row2.id });
  await user.click(await screen.findByRole('button', { name: '크게 보며 고치기' }));
  return user;
}

test('크게 보며 고치기를 누르면 가운데 표 위에 무대가 펼쳐지고, 작게를 누르면 접힌다', async () => {
  const user = await openBig();
  const s = stage()!;
  expect(s).not.toBeNull();
  expect(s.closest('main')).not.toBeNull();
  expect(useApp.get().bigPreview).toBe(true);
  expect(within(s).getByText('프로그램이 흉내 내어 그린 화면이에요. 실제 확인은 게임에서 해요.')).toBeVisible();
  expect(await within(s).findByRole('img', { name: '대사창 미리보기' })).toBeInTheDocument();
  await user.click(within(s).getByRole('button', { name: '작게' }));
  expect(stage()).toBeNull();
  expect(useApp.get().bigPreview).toBe(false);
});

test('맞춤 표시: n줄 / 최대 m줄 · 폭 p%, 넘치면 오류색', async () => {
  const user = await openBig();
  expect(await within(stage()!).findByText('1줄 / 최대 4줄 · 폭 10%')).not.toHaveClass('over');
  previewFake(api).layout = () => layout({ lines: [{ runs: [text('긴 줄')], width: 600, overflow: 60 }], maxWidth: 600, available: 540 });
  await user.type(within(stage()!).getByLabelText('큰 미리보기 번역'), '가');
  expect(await within(stage()!).findByText('1줄 / 최대 4줄 · 폭 111%')).toHaveClass('over');
});

test('무대의 입력칸과 항목의 번역 칸은 같은 초안을 쓴다', async () => {
  const user = await openBig();
  const big = within(stage()!).getByLabelText('큰 미리보기 번역');
  await user.type(big, '어라');
  expect(screen.getByLabelText('번역')).toHaveValue('어라');
  await user.type(screen.getByLabelText('번역'), '?');
  expect(big).toHaveValue('어라?');
  expect(api.calls.some((c) => c[0] === 'unit.setTranslation')).toBe(false);
  await user.type(big, '{Control>}{Enter}{/Control}');
  expect(api.calls).toContainEqual(['unit.setTranslation', row2.id, '어라?']);
});

test('이전 줄·다음 줄은 지금 보이는 목록에서 미리보기가 있는 줄로 옮긴다', async () => {
  const user = await openBig();
  const s = within(stage()!);
  expect(s.getByRole('button', { name: '이전 줄' })).toBeDisabled();
  // The two choice lines in between have no message window to show.
  await user.click(s.getByRole('button', { name: '다음 줄' }));
  expect(useApp.get().selectedId).toBe('r-map-2');
  expect(within(stage()!).getByRole('button', { name: '다음 줄' })).toBeDisabled();
  await user.click(within(stage()!).getByRole('button', { name: '이전 줄' }));
  expect(useApp.get().selectedId).toBe(row2.id);
});

test('채팅 탭으로 가면 무대가 꺼지고, 켜면 오른쪽 탭이 항목으로 돌아온다', async () => {
  const user = await openBig();
  await user.click(screen.getByRole('tab', { name: '채팅' }));
  expect(useApp.get().bigPreview).toBe(false);
  expect(stage()).toBeNull();
  act(() => { useApp.setBigPreview(true); });
  expect(useApp.get().rightTab).toBe('item');
  expect(stage()).not.toBeNull();
});

test('텍스트 화면이 아니거나 고른 줄에 미리보기가 없으면 무대를 그리지 않는다', async () => {
  await openBig();
  act(() => { useApp.setView('settings'); });
  expect(stage()).toBeNull();
  act(() => { useApp.setView('text'); });
  expect(stage()).not.toBeNull();
  await act(async () => { await useApp.selectRow(row1.id); });
  expect(stage()).toBeNull();
});
