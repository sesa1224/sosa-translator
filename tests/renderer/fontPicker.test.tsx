import { act, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { useApp } from '../../src/renderer/state';
import type { FontInfo } from '../../src/shared/api';
import { fakeApi, openFakeWith, previewFake, type FakeApi } from './fakeApi';

vi.mock('../../src/renderer/preview/fontFace', () => ({ ensureFontFace: vi.fn(async (p: string) => `fam-${p.length}`), fontFamilyName: () => 'fam' }));

const font = (p: Partial<FontInfo> & { path: string; displayName: string }): FontInfo =>
  ({ family: p.displayName, style: 'Regular', hasHangul: true, source: 'system', ...p });
const MALGUN = font({ path: 'C:/Windows/Fonts/malgun.ttf', displayName: '맑은 고딕', family: 'Malgun Gothic' });
const NANUM = font({ path: 'C:/Windows/Fonts/NanumGothic.ttf', displayName: '나눔고딕', family: 'NanumGothic' });
const ARIAL = font({ path: 'C:/Windows/Fonts/arial.ttf', displayName: 'Arial', family: 'Arial', hasHangul: false });
const GAMEFONT = font({ path: 'C:/game/fonts/mplus.ttf', displayName: 'M+ 게임', family: 'Mplus', source: 'game' });

let api: FakeApi;
beforeEach(() => {
  api = fakeApi();
  previewFake(api).fontList = { fonts: [MALGUN, NANUM, ARIAL, GAMEFONT], skippedCollections: 0 };
});

async function openPicker() {
  const user = await openFakeWith(api);
  act(() => { useApp.openFontPicker(); });
  await screen.findByRole('heading', { name: '설정' });
  await screen.findByText('맑은 고딕');
  return user;
}
const list = () => screen.getByRole('listbox', { name: '폰트 목록' });
const names = () => within(list()).getAllByRole('option').map((o) => o.querySelector('.fp-name')!.textContent);

test('한글 있는 폰트만 (기본 켜짐), 끄면 한글 없음 표시와 함께 나온다', async () => {
  const user = await openPicker();
  expect(screen.getByText('여기서 고른 폰트는 미리보기와 폭 검사에 쓰여요. 게임에 넣는 기능은 아직 없어요.')).toBeVisible();
  expect(screen.getByLabelText('한글 있는 폰트만')).toBeChecked();
  expect(names()).not.toContain('Arial');
  await user.click(screen.getByLabelText('한글 있는 폰트만'));
  expect(names()).toContain('Arial');
  const arial = within(list()).getAllByRole('option').find((o) => o.textContent?.includes('Arial'))!;
  expect(within(arial).getByText('한글 없음')).toBeVisible();
});

test('검색은 displayName 과 family 에서 대소문자 없이 찾는다', async () => {
  const user = await openPicker();
  await user.type(screen.getByLabelText('폰트 검색'), 'malgun');
  await waitFor(() => expect(names()).toEqual(['맑은 고딕']));
  await user.clear(screen.getByLabelText('폰트 검색'));
  await user.type(screen.getByLabelText('폰트 검색'), '나눔');
  await waitFor(() => expect(names()).toEqual(['나눔고딕']));
});

test('분류 칩', async () => {
  const user = await openPicker();
  await user.click(screen.getByRole('button', { name: '게임에 든 폰트' }));
  expect(names()).toEqual(['M+ 게임']);
  await user.click(screen.getByRole('button', { name: '설치된 폰트' }));
  expect(names()).toEqual(['맑은 고딕', '나눔고딕']);
  await user.click(screen.getByRole('button', { name: '직접 고른 파일' }));
  expect(within(list()).queryAllByRole('option')).toHaveLength(0);
});

test('줄에 마우스를 올리면 200ms 뒤 그 폰트로 넘침을 세고, 정하지는 않는다', async () => {
  previewFake(api).overflow = (p) => ({ overflowing: p === NANUM.path ? 17 : 0, checked: 40, missingGlyphs: p === NANUM.path ? 3 : 0 });
  const user = await openPicker();
  const row = within(list()).getAllByRole('option').find((o) => o.textContent?.includes('나눔고딕'))!;
  await user.hover(row);
  expect(api.calls).not.toContainEqual(['preview.countOverflow', NANUM.path]);
  expect(await screen.findByText('이 폰트로 바꾸면 넘치는 줄 17개')).toBeVisible();
  expect(api.calls).toContainEqual(['preview.countOverflow', NANUM.path]);
  expect(screen.getByText('이 폰트에 없는 글자 3개')).toBeVisible();
  expect(api.calls.some((c) => c[0] === 'preview.setFont')).toBe(false);
  expect(screen.getByText('프로그램이 흉내 내어 그린 화면이에요. 실제 확인은 게임에서 해요.')).toBeVisible();
});

test('넘치는 줄이 없으면 그렇게 말한다', async () => {
  const user = await openPicker();
  const row = within(list()).getAllByRole('option').find((o) => o.textContent?.includes('맑은 고딕'))!;
  await user.hover(row);
  expect(await screen.findByText('이 폰트로는 넘치는 줄이 없어요')).toBeVisible();
});

test('줄을 누르면 정하고, 폰트 정하지 않기로 되돌린다', async () => {
  const user = await openPicker();
  const row = within(list()).getAllByRole('option').find((o) => o.textContent?.includes('맑은 고딕'))!;
  await user.click(row);
  expect(api.calls).toContainEqual(['preview.setFont', MALGUN.path]);
  act(() => { api.emit('preview:changed', previewFake(api).state); });
  await waitFor(() => expect(within(list()).getAllByRole('option').find((o) => o.textContent?.includes('맑은 고딕'))).toHaveAttribute('aria-selected', 'true'));
  await user.click(screen.getByRole('button', { name: '폰트 정하지 않기' }));
  expect(api.calls).toContainEqual(['preview.setFont', null]);
});

test('모음 파일 수와 직접 고르기', async () => {
  previewFake(api).fontList = { fonts: [MALGUN], skippedCollections: 3 };
  previewFake(api).picked = font({ path: 'D:/my.ttf', displayName: '내 폰트', source: 'user' });
  const user = await openPicker();
  expect(screen.getByText('모음 파일(.ttc) 3개는 아직 쓸 수 없어요')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '폰트 파일 직접 고르기' }));
  expect(api.calls).toContainEqual(['fonts.pickFile']);
  expect(await screen.findByText('내 폰트')).toBeVisible();
});

test('치수 고치기와 자동 값으로 되돌리기', async () => {
  const user = await openPicker();
  await user.click(screen.getByText('대사창 치수 고치기'));
  const size = screen.getByLabelText('글자 크기');
  expect(size).toHaveAttribute('placeholder', '26');
  await user.type(size, '24{Enter}');
  expect(api.calls).toContainEqual(['preview.setOverrides', { fontSize: 24 }]);
  const pv = previewFake(api);
  act(() => { api.emit('preview:changed', { ...pv.state, settings: { ...pv.state.settings, overrides: { fontSize: 24 } } }); });
  await user.click(screen.getByRole('button', { name: '자동 값으로 되돌리기' }));
  expect(api.calls.at(-1)).toEqual(['preview.setOverrides', {}]);
});

test('미리보기 예시 대사: 번역이 없으면 기본 문장과 선택지', async () => {
  await openPicker();
  expect(screen.getByText('월광초를 3개 모아다 줄래?')).toBeVisible();
  expect(screen.getByText('보답으로 150골드 줄게.')).toBeVisible();
  expect(screen.getByText('좋아')).toBeVisible();
  expect(screen.getByText('다음에')).toBeVisible();
});
