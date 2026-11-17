import { act, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { TOAST_MS, useApp } from '../../src/renderer/state';
import type { JobProgress } from '../../src/shared/api';
import { fakeApi, openFakeWith } from './fakeApi';

afterEach(() => { vi.useRealTimers(); });

const job = (p: Partial<JobProgress>): JobProgress => ({ kind: 'translate', state: 'running', done: 0, total: 5, label: '', usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 }, declined: 0, errors: 0, ...p });
const toasts = () => within(screen.getByRole('region', { name: '알림' }));

test('번역 작업이 끝나면 몇 줄을 했는지 알림이 뜨고 3초 뒤 사라진다', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const api = fakeApi();
  await openFakeWith(api);
  api.emit('job:progress', job({ done: 2 }));
  expect(toasts().queryByText(/번역했습니다/)).toBeNull();
  api.emit('job:progress', job({ state: 'done', done: 5 }));
  expect(toasts().getByText('5줄을 번역했습니다')).toBeVisible();
  // The same end reported again does not make a second one.
  api.emit('job:progress', job({ state: 'done', done: 5 }));
  expect(toasts().getAllByText('5줄을 번역했습니다')).toHaveLength(1);
  act(() => { vi.advanceTimersByTime(TOAST_MS - 100); });
  expect(toasts().getByText('5줄을 번역했습니다').closest('.toast')).toHaveClass('out');
  act(() => { vi.advanceTimersByTime(200); });
  expect(toasts().queryByText('5줄을 번역했습니다')).toBeNull();
});

test('검수와 용어집 초안의 끝에도 알림. 실패나 멈춤에는 띄우지 않는다', async () => {
  const api = fakeApi();
  await openFakeWith(api);
  api.emit('job:progress', job({ kind: 'review', state: 'running' }));
  api.emit('job:progress', job({ kind: 'review', state: 'done', done: 12 }));
  expect(toasts().getByText('12줄을 검수했습니다')).toBeVisible();
  api.emit('job:progress', job({ kind: 'draft', state: 'running' }));
  api.emit('job:progress', job({ kind: 'draft', state: 'done', done: 3 }));
  expect(toasts().getByText('용어집 초안을 만들었습니다')).toBeVisible();
  api.emit('job:progress', job({ state: 'running' }));
  api.emit('job:progress', job({ state: 'failed', message: '연결이 끊겼습니다' }));
  api.emit('job:progress', job({ state: 'running' }));
  api.emit('job:progress', job({ state: 'stopped' }));
  expect(toasts().queryByText(/번역했습니다/)).toBeNull();
});

test('여러 알림은 쌓인다', async () => {
  const api = fakeApi();
  await openFakeWith(api);
  act(() => { useApp.notify('하나'); useApp.notify('둘'); });
  expect(toasts().getByText('하나')).toBeVisible();
  expect(toasts().getByText('둘')).toBeVisible();
});

test('되돌리기 뒤에 알림', async () => {
  const api = fakeApi();
  api.chat.undo = async () => ['r-map-1'];
  const user = await openFakeWith(api, { rightTab: 'chat' });
  await user.click(screen.getByRole('button', { name: '방금 변경 되돌리기' }));
  expect(await toasts().findByText('1줄을 되돌렸습니다')).toBeVisible();

  api.historyResult = { restored: 4, skipped: 1 };
  await act(async () => { await useApp.cancelAction('a1'); });
  expect(toasts().getByText('4줄을 되돌렸습니다 · 건너뜀 1줄')).toBeVisible();
  api.historyResult = { restored: 7, skipped: 0 };
  await act(async () => { await useApp.rollbackTo('a1'); });
  expect(toasts().getByText('7줄을 되돌렸습니다')).toBeVisible();
});

test('되돌린 것이 없으면 알림을 띄우지 않는다', async () => {
  const api = fakeApi();
  const user = await openFakeWith(api, { rightTab: 'chat' });
  await user.click(screen.getByRole('button', { name: '방금 변경 되돌리기' }));
  await screen.findByText('되돌릴 채팅 변경이 없어요');
  expect(toasts().queryByText(/되돌렸습니다/)).toBeNull();
});

test('내보내기와 가져오기가 끝나면 알림', async () => {
  const api = fakeApi();
  api.importPlanValue = { ok: [{ id: 'r-map-1', target: '야호', issues: [] }], conflicts: [], unknownIds: [], invalid: 0 } as never;
  const user = await openFakeWith(api);
  await user.click(screen.getByRole('button', { name: /^내보내기/ }));
  expect(await toasts().findByText('내보냈습니다 · 약초원.json')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '가져오기' }));
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: '가져오기' }));
  expect(await toasts().findByText('번역 1개를 가져왔습니다')).toBeVisible();
});
