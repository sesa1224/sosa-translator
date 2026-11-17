// The chat's helper character, step list, result card, quick instructions and first-open look.
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { type UserEvent } from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';
import { INK_DONE_MS } from '../../src/renderer/components/Inkdrop';
import { useApp } from '../../src/renderer/state';
import { fakeApi, itemId, openFakeWith, type FakeApi } from './fakeApi';

let api: FakeApi;
let user: UserEvent;
const zero = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };

beforeEach(async () => {
  cleanup();
  api = fakeApi();
  user = await openFakeWith(api, { rightTab: 'chat' });
});

const headInk = () => document.querySelector('.chat-head svg.ink')!;

test('먹물이: 평소, 일하는 중, 방금 끝남, 다시 평소', async () => {
  expect(headInk()).toHaveAttribute('aria-hidden', 'true');
  expect(headInk()).toHaveClass('ink-idle');
  await user.type(screen.getByLabelText('메시지'), '안녕{Enter}');
  expect(headInk()).toHaveClass('ink-work');
  act(() => { api.emit('chat:event', { type: 'turn-end', ok: true, usage: zero }); });
  expect(headInk()).toHaveClass('ink-done');
  await waitFor(() => expect(headInk()).toHaveClass('ink-idle'), { timeout: INK_DONE_MS + 1500 });
});

test('도구 활동은 세로 단계: 진행 중은 돌고, 끝나면 체크, 실패는 오류', async () => {
  await user.type(screen.getByLabelText('메시지'), '찾아 줘{Enter}');
  act(() => { api.emit('chat:event', { type: 'tool-start', id: 't1', name: 'search_units', input: { query: '記録' } }); });
  const step = () => screen.getByText('검색 · "記録"').closest('.step')!;
  expect(step()).toHaveClass('run');
  act(() => { api.emit('chat:event', { type: 'tool-end', id: 't1', isError: false, summary: '{}' }); });
  expect(step()).toHaveClass('ok');
  act(() => { api.emit('chat:event', { type: 'tool-start', id: 't2', name: 'get_unit', input: { id: 'nope' } }); });
  act(() => { api.emit('chat:event', { type: 'tool-end', id: 't2', isError: true, summary: '{}' }); });
  expect(screen.getByText('읽음 · nope').closest('.step')).toHaveClass('err');
  // Both steps sit in one list beside the helper.
  expect(step().parentElement).toBe(screen.getByText('읽음 · nope').closest('.step')!.parentElement);
});

test('줄을 고친 대답 뒤에는 결과 카드: 바뀐 줄 보기', async () => {
  await user.type(screen.getByLabelText('메시지'), '고쳐 줘{Enter}');
  act(() => {
    api.emit('chat:event', { type: 'tool-start', id: 't1', name: 'set_translation', input: { id: itemId, target: '월광초' } });
    api.emit('chat:event', { type: 'tool-end', id: 't1', isError: false, summary: '{}' });
    api.emit('chat:event', { type: 'text-delta', text: '고쳤어요' });
    api.emit('chat:event', { type: 'turn-end', ok: true, usage: zero });
  });
  const card = screen.getByRole('region', { name: '1줄을 고쳤어요' });
  expect(within(card).getByText('월광초')).toBeVisible();
  await user.click(within(card).getByRole('button', { name: '바뀐 줄 보기' }));
  expect(useApp.get().idFilter).toEqual([itemId]);
});

test('빠른 지시는 입력칸만 채우고 보내지 않는다. 붙은 항목이 없으면 "이 줄" 지시는 흐리다', async () => {
  const quick = screen.getByRole('group', { name: '빠른 지시' });
  expect(within(quick).getByRole('button', { name: '이 줄 다듬기' })).toBeDisabled();
  await user.click(within(quick).getByRole('button', { name: '용어 확인' }));
  expect((screen.getByLabelText('메시지') as HTMLTextAreaElement).value).not.toBe('');
  act(() => { useApp.talkAbout(itemId); });
  const polish = within(screen.getByRole('group', { name: '빠른 지시' })).getByRole('button', { name: '이 줄 다듬기' });
  expect(polish).toBeEnabled();
  await user.click(polish);
  expect((screen.getByLabelText('메시지') as HTMLTextAreaElement).value).toMatch(/^이 줄/);
  expect(api.calls.some((c) => c[0] === 'chat.send')).toBe(false);
});

test('처음 연 모습: 큰 먹물이, 인사, 안내 문구, 누르면 입력칸에 들어가는 예시', async () => {
  const empty = document.querySelector('.chat-empty') as HTMLElement;
  expect(empty.querySelector('svg.ink')).not.toBeNull();
  expect(within(empty).getByRole('heading', { name: '무엇을 도와드릴까요?' })).toBeVisible();
  expect(within(empty).getByText('게임 텍스트에 대해 물어보거나 스크린샷을 붙여 넣어 보세요.')).toBeVisible();
  const examples = within(empty).getAllByRole('button');
  expect(examples.length).toBeGreaterThanOrEqual(2);
  await user.click(examples[0]);
  expect((screen.getByLabelText('메시지') as HTMLTextAreaElement).value).toBe(examples[0].textContent);
  expect(api.calls.some((c) => c[0] === 'chat.send')).toBe(false);
});

test('머리줄: 이름, 모델 고르기, 토큰, 새 대화', async () => {
  const head = document.querySelector('.chat-head') as HTMLElement;
  expect(within(head).getByText('먹물이')).toBeVisible();
  expect(within(head).getByLabelText('채팅 모델')).toBeVisible();
  expect(within(head).getByText('이번 대화 0 토큰')).toBeVisible();
  expect(within(head).getByRole('button', { name: '새 대화' })).toBeVisible();
});

test('결과 카드의 되돌리기는 이 대화가 남긴 행동을 취소하고, 그 뒤에 다른 행동이 있으면 하지 않는다', async () => {
  const reply = () => act(() => {
    api.emit('chat:event', { type: 'tool-start', id: 't1', name: 'set_translation', input: { id: itemId, target: '월광초' } });
    api.emit('chat:event', { type: 'tool-end', id: 't1', isError: false, summary: '{}' });
    api.emit('chat:event', { type: 'turn-end', ok: true, usage: zero });
  });
  await user.type(screen.getByLabelText('메시지'), '고쳐 줘{Enter}');
  reply();
  api.historyValue = [{ id: 'a-user', at: '2026-11-17T10:00:00Z', origin: 'user', label: '직접 고침', count: 1 }];
  await user.click(within(screen.getByRole('region', { name: '1줄을 고쳤어요' })).getByRole('button', { name: '되돌리기' }));
  expect(await screen.findByText('그 뒤에 다른 변경이 있어요. 작업 기록에서 되돌려 주세요')).toBeVisible();
  expect(api.calls.some((c) => c[0] === 'history.cancel')).toBe(false);
  api.historyValue = [{ id: 'a-chat', at: '2026-11-17T10:01:00Z', origin: 'chat', label: '채팅에서 바꿈 1개', count: 1 }];
  await user.click(within(screen.getByRole('region', { name: '1줄을 고쳤어요' })).getByRole('button', { name: '되돌리기' }));
  expect(api.calls).toContainEqual(['history.cancel', 'a-chat']);
});