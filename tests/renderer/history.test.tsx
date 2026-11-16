import { screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import type { ActionSummary } from '../../src/shared/api';
import { fakeApi, openFakeWith, type FakeApi } from './fakeApi';

let api: FakeApi;
beforeEach(() => {
  api = fakeApi();
  vi.restoreAllMocks();
});

const actions: ActionSummary[] = [
  { id: 'a3', at: '2026-11-16T10:30:00.000Z', origin: 'review', label: '검수 의견 213개 받음', count: 213 },
  { id: 'a2', at: '2026-11-16T10:20:00.000Z', origin: 'batch', label: '전체 번역 1,240개', count: 1240, undoneAt: '2026-11-16T10:25:00.000Z' },
  { id: 'a1', at: '2026-11-16T10:10:00.000Z', origin: 'user', label: '번역 고침', count: 1 },
];

async function openHistory() {
  api.historyValue = actions;
  const user = await openFakeWith(api);
  await user.click(within(screen.getByRole('navigation', { name: '작업 메뉴' })).getByRole('button', { name: '작업 기록' }));
  await screen.findByRole('heading', { name: '작업 기록' });
  return user;
}

test('최신순 목록: 누가, 무엇을, 몇 줄, 취소된 것은 표시', async () => {
  await openHistory();
  expect(screen.getByText('용어집·판단·그림·이벤트 수정은 여기서 되돌리지 않아요', { exact: false })).toBeVisible();
  const items = await screen.findAllByRole('article');
  expect(items).toHaveLength(3);
  expect(within(items[0]).getByText('검수 의견 213개 받음')).toBeVisible();
  expect(within(items[0]).getByText('검수')).toBeVisible();
  expect(within(items[0]).getByText('213줄')).toBeVisible();
  expect(within(items[1]).getByText('번역 작업')).toBeVisible();
  expect(within(items[1]).getByText('취소됨')).toBeVisible();
  expect(within(items[1]).getByRole('button', { name: '이 행동만 취소' })).toBeDisabled();
  expect(within(items[2]).getByText('사용자')).toBeVisible();
});

test('이 행동만 취소: 개수를 묻고, 결과를 알린다', async () => {
  const user = await openHistory();
  api.historyResult = { restored: 212, skipped: 1 };
  const ask = vi.spyOn(window, 'confirm').mockReturnValue(true);
  const [first] = await screen.findAllByRole('article');
  await user.click(within(first).getByRole('button', { name: '이 행동만 취소' }));
  expect(ask.mock.calls[0][0]).toContain('213');
  expect(api.calls).toContainEqual(['history.cancel', 'a3']);
  expect(await screen.findByText('212개를 되돌렸어요. 1개는 그 뒤에 바뀌어서 그대로 뒀어요.')).toBeVisible();
});

test('이 시점으로 되돌리기: 묻고 거절하면 부르지 않는다', async () => {
  const user = await openHistory();
  const ask = vi.spyOn(window, 'confirm').mockReturnValue(false);
  const items = await screen.findAllByRole('article');
  await user.click(within(items[2]).getByRole('button', { name: '이 시점으로 되돌리기' }));
  expect(ask).toHaveBeenCalled();
  expect(api.calls.some((c) => c[0] === 'history.rollback')).toBe(false);
  ask.mockReturnValue(true);
  api.historyResult = { restored: 1, skipped: 0 };
  await user.click(within(items[2]).getByRole('button', { name: '이 시점으로 되돌리기' }));
  expect(api.calls).toContainEqual(['history.rollback', 'a1']);
  expect(await screen.findByText('1개를 되돌렸어요.')).toBeVisible();
});
