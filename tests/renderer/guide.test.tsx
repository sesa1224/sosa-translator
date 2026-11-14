import { act, cleanup, screen } from '@testing-library/react';
import { type UserEvent } from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { useApp } from '../../src/renderer/state';
import { fakeApi, openFakeWith, type FakeApi } from './fakeApi';

let api: FakeApi;
let user: UserEvent;

async function openGuide() {
  cleanup();
  api = fakeApi({});
  user = await openFakeWith(api);
  await user.click(screen.getByRole('button', { name: '번역 지침' }));
  await screen.findByRole('heading', { name: '번역 지침' });
}
const box = () => screen.getByLabelText(/에 보내는 글$/) as HTMLTextAreaElement;

test('보내는 글 전체를 보여 주고, 고치면 그 글을 저장한다', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    await openGuide(); expect(useApp.get().view).toBe('guide');
    await vi.waitFor(() => expect(box().value).toContain('translate 머리말'));
    expect(box().value).toContain('<번역 지침>');
    await user.type(box(), ' 추가');
    await act(async () => { vi.advanceTimersByTime(900); });
    expect(api.calls.some(c => c[0] === 'glossary.setPromptText' && c[1] === 'translate' && String(c[2]).endsWith(' 추가'))).toBe(true);
  } finally {
    vi.useRealTimers();
  }
});
test('탭을 바꾸면 고치던 글을 먼저 저장하고 그 탭의 글을 읽는다', async () => {
  await openGuide(); await vi.waitFor(() => expect(box().value).toContain('translate 머리말'));
  await user.type(box(), '!');
  await user.click(screen.getByRole('button', { name: '내보내기' }));
  expect(api.calls.some(c => c[0] === 'glossary.setPromptText' && c[1] === 'translate' && String(c[2]).endsWith('!'))).toBe(true);
  await vi.waitFor(() => expect(box().value).toContain('export 머리말'));
  expect(screen.getByText(/instructions 에 그대로/)).toBeVisible();
});
test('되돌리기: 이 탭의 문구, 지침 본문', async () => {
  cleanup();
  api = fakeApi({ glossary: { prompts: { review: '고친 글' } } });
  user = await openFakeWith(api);
  act(() => { useApp.setView('guide'); });
  await screen.findByRole('heading', { name: '번역 지침' });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  expect(screen.getByRole('button', { name: '처음 문구로 되돌리기' })).toBeDisabled();   // translate is not edited
  await user.click(screen.getByRole('button', { name: '검수' }));
  expect(screen.getByText('고친 문구 사용 중')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '처음 문구로 되돌리기' }));
  expect(api.calls).toContainEqual(['glossary.setPromptText', 'review', null]);
  await user.click(screen.getByRole('button', { name: '지침 본문을 기본 지침으로' }));
  expect(api.calls).toContainEqual(['glossary.setStyleGuide', '기본 지침']);
});
