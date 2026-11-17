import { act, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import type { AppSettings, Layout } from '../../src/shared/api';
import { useApp } from '../../src/renderer/state';
import { fakeApi, openFakeWith, previewFake, row1, row2, type FakeApi } from './fakeApi';

// jsdom has no FontFace and no canvas (the big preview draws the message window).
vi.mock('../../src/renderer/preview/fontFace', () => ({ ensureFontFace: vi.fn(async () => 'fake-family'), fontFamilyName: () => 'fake-family' }));
vi.mock('../../src/renderer/preview/palette', async (orig) => {
  const real = await orig<typeof import('../../src/renderer/preview/palette')>();
  return { ...real, paletteFromSkin: vi.fn(async () => real.DEFAULT_PALETTE) };
});

const layout = (): Layout => ({ lines: [{ runs: [{ type: 'text', text: '가나다', color: 0, size: 26 }], width: 78, overflow: 0 }], maxWidth: 78, available: 768, lineOverflow: 0, missingGlyphs: 0 });

function withPreview(api: FakeApi): FakeApi {
  const pv = previewFake(api);
  pv.state = { ...pv.state, settings: { fontPath: 'C:/fonts/game.ttf', fontName: '게임체', overrides: {} } };
  pv.layout = () => layout();
  return api;
}

function setWidth(w: number) {
  act(() => {
    window.innerWidth = w;
    window.dispatchEvent(new Event('resize'));
  });
}

const aside = () => screen.getByRole('complementary', { name: '항목과 채팅' });
const pane = () => document.getElementById('right-pane')!;
const drawer = () => screen.queryByRole('region', { name: '항목과 채팅 서랍' });
const rowOf = (text: string) => screen.getAllByRole('row').find((r) => r.textContent?.includes(text))!;
const savedPanel = (api: FakeApi) => api.calls.filter((c) => c[0] === 'settings.set' && 'rightPanelCollapsed' in (c[1] as object)).map((c) => (c[1] as Partial<AppSettings>).rightPanelCollapsed);

let api: FakeApi;
beforeEach(() => { api = withPreview(fakeApi()); });

test('넓은 창: 기본은 펼친 상태, 접기 단추로 좁은 띠가 되고 띠의 단추로 다시 연다', async () => {
  const user = await openFakeWith(api, { select: row2.id });
  const fold = screen.getByRole('button', { name: '오른쪽 패널 접기' });
  expect(fold).toHaveAttribute('aria-expanded', 'true');
  expect(aside()).not.toHaveClass('collapsed');
  await user.click(fold);
  expect(aside()).toHaveClass('collapsed');
  expect(pane()).toHaveAttribute('inert');
  // Focus does not stay behind in the hidden pane.
  expect(screen.getByRole('button', { name: '항목 열기' })).toHaveFocus();
  expect(savedPanel(api)).toEqual([{ wide: true }]);
  // The strip's buttons open the panel at the tab they name.
  const openChat = screen.getByRole('button', { name: '채팅 열기' });
  expect(openChat).toHaveAttribute('title');
  expect(openChat).toHaveAttribute('aria-expanded', 'false');
  await user.click(openChat);
  expect(aside()).not.toHaveClass('collapsed');
  expect(pane()).not.toHaveAttribute('inert');
  expect(useApp.get().rightTab).toBe('chat');
  expect(savedPanel(api)).toEqual([{ wide: true }, { wide: false }]);
  await user.click(screen.getByRole('button', { name: '오른쪽 패널 접기' }));
  await user.click(screen.getByRole('button', { name: '항목 열기' }));
  expect(useApp.get().rightTab).toBe('item');
  // A wide window keeps the panel in its own column: no drawer.
  expect(drawer()).toBeNull();
});

test('좁은 창: 기본은 접힌 상태, 줄을 누르면 서랍이 열리고 닫기와 Esc 로 닫힌다', async () => {
  window.innerWidth = 1100;
  const user = await openFakeWith(api);
  expect(aside()).toHaveClass('collapsed');
  expect(pane()).toHaveAttribute('inert');
  await user.click(rowOf('じゃない'));
  expect(useApp.get().selectedId).toBe(row2.id);
  const d = drawer()!;
  expect(d).not.toBeNull();
  expect(aside()).toHaveClass('drawer');
  expect(pane()).not.toHaveAttribute('inert');
  // Opening on a pick is not the user's choice of a default: nothing is saved.
  expect(savedPanel(api)).toEqual([]);
  // The table stays usable under the open drawer; another line changes what the drawer shows.
  await user.click(rowOf('リナ'));
  expect(useApp.get().selectedId).toBe(row1.id);
  expect(drawer()).not.toBeNull();
  await user.click(within(d).getByRole('button', { name: '오른쪽 패널 닫기' }));
  expect(drawer()).toBeNull();
  expect(aside()).toHaveClass('collapsed');
  await user.click(rowOf('じゃない'));
  expect(drawer()).not.toBeNull();
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  expect(drawer()).toBeNull();
});

test('좁은 창: 방향키로 줄만 옮기면 서랍이 다시 튀어나오지 않고, Enter 로 연다', async () => {
  window.innerWidth = 1100;
  const user = await openFakeWith(api);
  await user.click(rowOf('リナ'));
  expect(drawer()).not.toBeNull();
  await user.keyboard('{Escape}');
  expect(drawer()).toBeNull();
  const body = screen.getByRole('table', { name: '텍스트 표' }).querySelector('.tbody') as HTMLElement;
  fireEvent.keyDown(body, { key: 'ArrowDown' });
  expect(useApp.get().selectedId).not.toBe(row1.id);
  expect(drawer()).toBeNull();
  fireEvent.keyDown(body, { key: 'Enter' });
  expect(drawer()).not.toBeNull();
});

test('창 폭 구간마다 기본값이 다르고, 직접 접거나 편 것은 그 구간에서 기억한다', async () => {
  api = withPreview(fakeApi({ settings: { rightPanelCollapsed: { narrow: false } } }));
  const user = await openFakeWith(api);
  // Wide: nothing remembered, so open in its column.
  expect(aside()).not.toHaveClass('collapsed');
  expect(drawer()).toBeNull();
  // Narrow: remembered open, so the drawer.
  setWidth(1100);
  expect(aside()).toHaveClass('drawer');
  await user.click(screen.getByRole('button', { name: '오른쪽 패널 닫기' }));
  expect(savedPanel(api).at(-1)).toEqual({ narrow: true });
  setWidth(1500);
  expect(aside()).not.toHaveClass('collapsed');
  await user.click(screen.getByRole('button', { name: '오른쪽 패널 접기' }));
  expect(savedPanel(api).at(-1)).toEqual({ narrow: true, wide: true });
  setWidth(1100);
  expect(aside()).toHaveClass('collapsed');
  // Picking a line in a narrow window opens the drawer even though the wide band is folded too.
  await user.click(rowOf('リナ'));
  expect(drawer()).not.toBeNull();
  setWidth(1500);
  expect(aside()).toHaveClass('collapsed');
});

test('접힌 동안에도 항목 패널과 채팅은 그려진 채로 남아 고치던 초안과 쓰던 글이 그대로다', async () => {
  const user = await openFakeWith(api, { select: row2.id });
  await user.type(screen.getByLabelText('번역'), '어라');
  await user.click(screen.getByRole('button', { name: '오른쪽 패널 접기' }));
  expect(screen.getByLabelText('번역')).toHaveValue('어라');
  await user.click(screen.getByRole('button', { name: '항목 열기' }));
  expect(screen.getByLabelText('번역')).toHaveValue('어라');
  expect(api.calls.some((c) => c[0] === 'unit.setTranslation')).toBe(false);

  await user.click(screen.getByRole('tab', { name: '채팅' }));
  await user.type(screen.getByLabelText('메시지'), '안녕');
  await user.click(screen.getByRole('button', { name: '오른쪽 패널 접기' }));
  await user.click(screen.getByRole('button', { name: '채팅 열기' }));
  expect(screen.getByLabelText('메시지')).toHaveValue('안녕');
});

test('큰 미리보기: 서랍에서 켜면 서랍이 닫히고, 접힌 패널 뒤에서도 무대의 입력칸으로 고쳐 저장한다', async () => {
  window.innerWidth = 1100;
  const user = await openFakeWith(api);
  await user.click(rowOf('じゃない'));
  await user.click(within(drawer()!).getByRole('button', { name: '크게 보며 고치기' }));
  const stage = screen.getByRole('region', { name: '크게 보며 고치기' });
  expect(drawer()).toBeNull();
  expect(aside()).toHaveClass('collapsed');
  // The stage edits the draft the folded item panel holds.
  const big = within(stage).getByLabelText('큰 미리보기 번역');
  await user.type(big, '어라');
  expect(screen.getByLabelText('번역')).toHaveValue('어라');
  await user.type(big, '{Control>}{Enter}{/Control}');
  expect(api.calls).toContainEqual(['unit.setTranslation', row2.id, '어라']);
  // While the stage is open, a picked line goes to the stage, not into a drawer over it.
  await user.click(rowOf('やった'));
  expect(drawer()).toBeNull();
  // Going to the chat still turns the stage off, and shows the chat.
  act(() => { useApp.setRightTab('chat'); });
  expect(useApp.get().bigPreview).toBe(false);
  expect(drawer()).not.toBeNull();
});

test('접힌 동안 다른 화면에서 채팅으로 보내면 패널이 열린다', async () => {
  window.innerWidth = 1100;
  await openFakeWith(api);
  act(() => { useApp.talkAboutImage('img/pictures/a.png'); });
  expect(drawer()).not.toBeNull();
  expect(useApp.get().rightTab).toBe('chat');
});
