import { screen, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import type { ActionLine, ActionSummary } from '../../src/shared/api';
import { fakeApi, openFakeWith, type FakeApi } from './fakeApi';

let api: FakeApi;
beforeEach(() => {
  api = fakeApi();
  vi.restoreAllMocks();
});

const actions: ActionSummary[] = [
  { id: 'a3', at: '2026-11-16T10:30:00.000Z', origin: 'review', label: '검수 의견 213개 받음', count: 213, preview: { source: 'メッセージ速度', target: '메시지 속도', more: 212 } },
  { id: 'a2', at: '2026-11-16T10:20:00.000Z', origin: 'batch', label: '전체 번역 1,240개', count: 1240, undoneAt: '2026-11-16T10:25:00.000Z', preview: { source: null, target: null, cleared: true, more: 1239 } },
  { id: 'a1', at: '2026-11-16T10:10:00.000Z', origin: 'user', label: '번역 고침', count: 1, preview: { source: 'リナ', target: '리나', status: { before: 'translated', after: 'needs-review' }, more: 0 } },
];

const line = (i: number, o: Partial<ActionLine> = {}): ActionLine => ({
  unitId: `u${i}`, exists: true, source: `原文${i}`, location: '맵4 · 이벤트3', before: { target: `전${i}`, status: 'translated' }, after: { target: `후${i}`, status: 'translated' }, ...o,
});

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

test('줄마다 첫 바뀐 문장 미리 보기: 원문 → 번역, 외 n줄, 번역 지움, 상태만 바뀜', async () => {
  await openHistory();
  expect(screen.getByText('줄을 누르면 바뀐 문장이 보여요.', { exact: false })).toBeVisible();
  const items = await screen.findAllByRole('article');
  expect(within(items[0]).getByText('メッセージ速度 → 메시지 속도')).toBeVisible();
  expect(within(items[0]).getByText('외 212줄')).toBeVisible();
  expect(within(items[1]).getByText('(지금은 없는 문장) → (번역 지움)')).toBeVisible();
  expect(within(items[2]).getByText('リナ · 번역 완료 → 검토 필요')).toBeVisible();
});

test('줄을 누르면 펼치고 다시 누르면 접는다, 받아 오기는 한 번', async () => {
  api.historyLines = { a3: [line(1, { before: { target: '메세지 속도', status: 'translated' }, after: { target: '메시지 속도', status: 'translated' } }), line(2, { after: { target: '전2', status: 'approved' } })] };
  const user = await openHistory();
  const [first] = await screen.findAllByRole('article');
  const toggle = within(first).getByRole('button', { expanded: false });
  await user.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const list = await within(first).findByRole('list', { name: '바뀐 문장' });
  const lines = within(list).getAllByRole('listitem');
  expect(lines).toHaveLength(2);
  expect(within(lines[0]).getByText('原文1')).toBeVisible();
  expect(within(lines[0]).getByText('맵4 · 이벤트3')).toBeVisible();
  expect(lines[0].querySelector('.diff-del')?.textContent).toBe('세');
  expect(lines[0].querySelector('.diff-add')?.textContent).toBe('시');
  expect(within(lines[1]).getByText('번역 완료 → 승인됨')).toBeVisible();
  expect(lines[1].querySelector('.diff-add')).toBeNull();
  await user.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(within(first).queryByRole('list', { name: '바뀐 문장' })).toBeNull();
  await user.click(toggle);
  await within(first).findByRole('list', { name: '바뀐 문장' });
  expect(api.calls.filter((c) => c[0] === 'history.detail')).toHaveLength(1);
});

test('키보드로도 펼치고, 취소 버튼을 눌러도 펼쳐지지 않는다, 취소된 행동도 펼친다', async () => {
  api.historyLines = { a3: [line(1)], a2: [line(1)] };
  const user = await openHistory();
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  const items = await screen.findAllByRole('article');
  await user.click(within(items[0]).getByRole('button', { name: '이 행동만 취소' }));
  await user.click(within(items[0]).getByRole('button', { name: '이 시점으로 되돌리기' }));
  expect(within(items[0]).queryByRole('list', { name: '바뀐 문장' })).toBeNull();
  expect(api.calls.some((c) => c[0] === 'history.detail')).toBe(false);
  within(items[1]).getByRole('button', { expanded: false }).focus();
  await user.keyboard('{Enter}');
  expect(await within(items[1]).findByRole('list', { name: '바뀐 문장' })).toBeVisible();
  expect(api.calls).toContainEqual(['history.detail', 'a2', 0, 100]);
});

test('외 n줄 더 보기는 다음 100줄을 받는다', async () => {
  api.historyLines = { a3: Array.from({ length: 213 }, (_, i) => line(i)) };
  const user = await openHistory();
  const [first] = await screen.findAllByRole('article');
  await user.click(within(first).getByRole('button', { expanded: false }));
  const list = await within(first).findByRole('list', { name: '바뀐 문장' });
  expect(within(list).getAllByRole('listitem')).toHaveLength(100);
  await user.click(within(first).getByRole('button', { name: '외 113줄 더 보기' }));
  await vi.waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(200));
  expect(api.calls).toContainEqual(['history.detail', 'a3', 100, 100]);
  await user.click(within(first).getByRole('button', { name: '외 13줄 더 보기' }));
  await vi.waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(213));
  expect(within(first).queryByRole('button', { name: /더 보기/ })).toBeNull();
});

test('이 문장 보기: 목록 화면으로 가서 그 항목을 연다, 지금 없는 문장은 꺼짐', async () => {
  api.historyLines = { a3: [line(1, { unitId: 'r-actor', source: 'リナ' }), line(2, { exists: false, source: null, location: '' })] };
  const user = await openHistory();
  const [first] = await screen.findAllByRole('article');
  await user.click(within(first).getByRole('button', { expanded: false }));
  const lines = within(await within(first).findByRole('list', { name: '바뀐 문장' })).getAllByRole('listitem');
  expect(within(lines[1]).getByText('(지금은 없는 문장)')).toBeVisible();
  expect(within(lines[1]).getByRole('button', { name: '이 문장 보기' })).toBeDisabled();
  await user.click(within(lines[0]).getByRole('button', { name: '이 문장 보기' }));
  expect(api.calls).toContainEqual(['unit.get', 'r-actor']);
  expect(screen.queryByRole('heading', { name: '작업 기록' })).toBeNull();
});

test('날짜별로 묶어 날짜 머리글을 두고, 줄에는 시각·행위자(Claude 와 작업은 info)·조용한 되돌리기 단추', async () => {
  api.historyValue = [...actions, { id: 'a0', at: '2026-11-14T03:00:00.000Z', origin: 'chat', label: '채팅으로 고침', count: 2 }];
  const user = await openFakeWith(api);
  await user.click(within(screen.getByRole('navigation', { name: '작업 메뉴' })).getByRole('button', { name: '작업 기록' }));
  await screen.findByRole('heading', { name: '작업 기록' });
  const days = await within(document.querySelector('.history-view') as HTMLElement).findAllByRole('region');
  const dayOf = (d: string) => new Date(d).toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
  expect(days.map((d) => d.getAttribute('aria-label'))).toEqual([dayOf('2026-11-16T10:30:00.000Z'), dayOf('2026-11-14T03:00:00.000Z')]);
  expect(within(days[0]).getAllByRole('article')).toHaveLength(3);
  const [review, batch, mine] = within(days[0]).getAllByRole('article');
  expect(within(review).getByText('검수')).toHaveClass('who', 'who-info');
  expect(within(batch).getByText('번역 작업')).toHaveClass('who-info');
  expect(within(mine).getByText('사용자')).toHaveClass('who');
  expect(within(mine).getByText('사용자')).not.toHaveClass('who-info');
  expect(within(within(days[1]).getByRole('article')).getByText('채팅')).toHaveClass('who-info');
  // The time alone; the day is in the heading.
  const t = new Date('2026-11-16T10:30:00.000Z');
  expect(within(review).getByText(`${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`)).toBeVisible();
  for (const name of ['이 행동만 취소', '이 시점으로 되돌리기']) expect(within(review).getByRole('button', { name })).toHaveClass('ghost');
});
