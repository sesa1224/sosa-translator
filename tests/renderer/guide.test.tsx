import { act, cleanup, screen, within } from '@testing-library/react';
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
/** The one edit box of the whole text; the screen opens on the split view. */
const whole = () => user.click(screen.getByRole('button', { name: '통째로 고치기' }));
const box = () => screen.getByLabelText(/에 보내는 글$/) as HTMLTextAreaElement;

test('보내는 글 전체를 보여 주고, 고치면 그 글을 저장한다', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    await openGuide(); expect(useApp.get().view).toBe('guide'); await whole();
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
  await openGuide(); await whole(); await vi.waitFor(() => expect(box().value).toContain('translate 머리말'));
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

test('나눠 보기: 제목별 묶음으로 읽고, 한 묶음만 고쳐도 글 전체가 저장된다', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    await openGuide();
    const first = await screen.findByRole('region', { name: '기본 태도' });
    // Read first: no edit box until asked.
    expect(screen.queryByRole('textbox', { name: '기본 태도 본문' })).toBeNull();
    expect(screen.getByRole('button', { name: '나눠 보기' })).toHaveAttribute('aria-pressed', 'true');
    await user.click(within(first).getByRole('button', { name: '기본 태도 고치기' }));
    const part = screen.getByRole('textbox', { name: '기본 태도 본문' }) as HTMLTextAreaElement;
    expect(part.value.startsWith('## 기본 태도')).toBe(true);
    // Typed at the very end of the block: it must stay in this block and not run into the closing tag below.
    await user.type(part, '{Enter}- 새 규칙');
    await act(async () => { vi.advanceTimersByTime(900); });
    const saved = api.calls.filter(c => c[0] === 'glossary.setPromptText' && c[1] === 'translate').map(c => String(c[2])).pop()!;
    expect(saved).toContain('- 새 규칙');
    expect(saved).toContain('translate 머리말');
    expect(saved).toContain('<번역 지침>');
    expect(saved.includes(['- 새 규칙', '</번역 지침>'].join(String.fromCharCode(10)))).toBe(true);
    await user.click(within(first).getByRole('button', { name: '다 고쳤어요' }));
    expect(screen.queryByRole('textbox', { name: '기본 태도 본문' })).toBeNull();
    expect(within(screen.getByRole('region', { name: '기본 태도' })).getByText('새 규칙')).toBeVisible();
  } finally {
    vi.useRealTimers();
  }
});
