import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { useApp } from '../../src/renderer/state';
import type { Row, TextWindowInfo } from '../../src/shared/api';
import { baseRows, emptyRewrap, fakeApi, openFakeWith, previewFake, type FakeApi } from './fakeApi';

vi.mock('../../src/renderer/preview/fontFace', () => ({ ensureFontFace: vi.fn(async () => 'fam'), fontFamilyName: () => 'fam' }));

const info = (p: Partial<TextWindowInfo> = {}): TextWindowInfo => ({
  limit: { width: 768, maxLines: 4, fontSize: 26 }, detected: { width: 768, maxLines: 4, fontSize: 26 }, override: {}, hangulWidth: 26, faceIndent: 164, ...p,
});

let api: FakeApi;
beforeEach(() => {
  api = fakeApi();
  const pv = previewFake(api);
  pv.state = {
    ...pv.state,
    settings: { ...pv.state.settings, fontPath: 'C:/fonts/game.ttf' },
    windows: { message: info({ limit: { width: 600, maxLines: 3, fontSize: 26 }, override: { width: 600, maxLines: 3 } }), help: info({ limit: { width: 768, maxLines: 2, fontSize: 26 }, detected: { width: 768, maxLines: 2, fontSize: 26 } }) },
  };
});
afterEach(() => { vi.restoreAllMocks(); });

async function openSettings() {
  const user = await openFakeWith(api);
  act(() => { useApp.setView('settings'); });
  await screen.findByText('창 크기와 줄바꿈');
  return user;
}

test('설정: 창별 한 줄 너비와 줄 수, 감지한 값은 흐리게, 한글 약 n자', async () => {
  const user = await openSettings();
  const message = screen.getByRole('group', { name: '대사창' });
  const help = screen.getByRole('group', { name: '설명창' });
  expect(within(message).getByLabelText('한 줄 너비(px)')).toHaveValue('600');
  expect(within(message).getByLabelText('한 줄 너비(px)')).toHaveAttribute('placeholder', '768');
  expect(within(help).getByLabelText('줄 수')).toHaveValue('');
  expect(within(help).getByLabelText('줄 수')).toHaveAttribute('placeholder', '2');
  expect(screen.getByTestId('tw-message-chars')).toHaveTextContent('한글 약 23자 · 얼굴 그림이 있으면 436px');
  expect(screen.getByTestId('tw-help-chars')).toHaveTextContent('한글 약 29자');

  const width = within(help).getByLabelText('한 줄 너비(px)');
  await user.type(width, '900{Enter}');
  expect(api.calls).toContainEqual(['preview.setWindow', 'help', { width: 900 }]);
  expect(within(help).getByRole('button', { name: '설명창 기준 지우기' })).toBeDisabled();
  await user.click(within(message).getByRole('button', { name: '대사창 기준 지우기' }));
  expect(api.calls).toContainEqual(['preview.setWindow', 'message', { width: null, maxLines: null }]);
});

test('설정: 줄바꿈 다시 맞추기는 고칠 줄 수를 먼저 묻고, 아니요면 고치지 않는다', async () => {
  const pv = previewFake(api);
  pv.rewrapPlan = { ...emptyRewrap(), fixed: 312, unfixable: 4 };
  pv.rewrapResult = { ...emptyRewrap(), fixed: 312, unfixable: 4 };
  const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
  const user = await openSettings();
  await user.click(screen.getByRole('button', { name: '줄바꿈 다시 맞추기' }));
  expect(confirm.mock.calls[0][0]).toContain('창을 넘는 312줄의 줄바꿈을 다시 맞출까요?');
  expect(confirm.mock.calls[0][0]).toContain('자동으로 못 고치는 4줄은 그대로 둬요');
  expect(api.calls.some((c) => c[0] === 'project.rewrap')).toBe(false);
  await user.click(screen.getByRole('button', { name: '줄바꿈 다시 맞추기' }));
  expect(api.calls).toContainEqual(['project.rewrap', {}]);
  expect(await screen.findByRole('status')).toHaveTextContent('312줄의 줄바꿈을 다시 맞췄어요. 못 고친 4줄은 "창 넘침"에서 문장을 줄여 주세요');
});

test('설정: 게임 폰트가 없으면 버튼이 잠기고 글자 수 대신 안내', async () => {
  const pv = previewFake(api);
  pv.state = { ...pv.state, settings: { ...pv.state.settings, fontPath: null }, windows: { message: info({ hangulWidth: null }), help: info({ hangulWidth: null }) } };
  await openSettings();
  expect(screen.getByRole('button', { name: '줄바꿈 다시 맞추기' })).toBeDisabled();
  expect(screen.getByText('게임 폰트를 고르면 쓸 수 있어요')).toBeVisible();
  expect(screen.getByTestId('tw-help-chars')).toHaveTextContent('폰트를 고르면 글자 수가 보여요');
});

test('목록: 창 넘침 필터와 보이는 줄만 다시 맞추기', async () => {
  const rows: Row[] = baseRows.map((r) => (r.id === 'r-map-1' || r.id === 'r-map-2' ? { ...r, target: '가', status: 'translated', overflow: true } : r));
  api = fakeApi({ rows });
  previewFake(api).rewrapPlan = { ...emptyRewrap(), fixed: 2 };
  previewFake(api).rewrapResult = { ...emptyRewrap(), fixed: 2 };
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  const user = await openFakeWith(api);
  await user.click(await screen.findByRole('button', { name: '창 넘침 2' }));
  await waitFor(() => expect(screen.getByText('2줄')).toBeVisible());
  await user.click(screen.getByRole('button', { name: '줄바꿈 다시 맞추기' }));
  expect(api.calls).toContainEqual(['project.rewrapPlan', { ids: ['r-map-1', 'r-map-2'] }]);
  expect(api.calls).toContainEqual(['project.rewrap', { ids: ['r-map-1', 'r-map-2'] }]);
  expect(await screen.findByText('2줄의 줄바꿈을 다시 맞췄어요')).toBeVisible();
});

test('형식 규칙: 창을 넘는 줄은 자동으로 나누기 (기본 켬)', async () => {
  const user = await openFakeWith(api);
  act(() => { useApp.setView('glossary'); });
  // Rules are one of the glossary's three views.
  await user.click(within(await screen.findByRole('group', { name: '용어집 보기' })).getByRole('button', { name: '형식 규칙' }));
  const box = await screen.findByLabelText('창을 넘는 줄은 자동으로 나누기');
  expect(box).toBeChecked();
  await user.click(box);
  expect(api.calls).toContainEqual(['glossary.setRules', { autoRewrap: false }]);
});
