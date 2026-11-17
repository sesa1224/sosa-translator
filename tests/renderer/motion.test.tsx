import { act, screen, within } from '@testing-library/react';
import { afterEach, expect, test } from 'vitest';
import { motionClock } from '../../src/renderer/motion';
import { useApp } from '../../src/renderer/state';
import type { JobProgress, Row } from '../../src/shared/api';
import { baseRows, errorRowId, fakeApi, itemId, openFakeWith, row2, scopes, stats, type FakeApi } from './fakeApi';

// Motion is CSS; these check that the classes that start it go on at the moment the state changes, and only then.

const realNow = motionClock.now;
afterEach(() => { motionClock.now = realNow; });

const translated2: Row = { ...row2, target: 'あれ？\\N[1]じゃない！', status: 'translated' };
const rowsWith = (...changed: Row[]) => baseRows.map((r) => changed.find((c) => c.id === r.id) ?? r);
const tableRow = (text: string) => within(screen.getByRole('table', { name: '텍스트 표' })).getAllByText(text)[0].closest<HTMLElement>('[role="row"]')!;
const pill = (row: HTMLElement) => row.querySelector('.st')!;
const job = (p: Partial<JobProgress>): JobProgress => ({ kind: 'translate', state: 'running', done: 0, total: 2, label: '맵1 (1/1)', usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 }, declined: 0, errors: 0, ...p });
const changed = (api: FakeApi, ...rows: Row[]) => api.emit('project:changed', { rows, stats, scopes, origin: 'batch' });
const checks = () => screen.getByRole('group', { name: '검사' });

test('승인하면 방금 줄이 밝아지고 알약이 튄다. 시간이 지난 뒤 다시 그려져도 되풀이하지 않는다', async () => {
  const api = fakeApi({ rows: rowsWith(translated2) });
  const user = await openFakeWith(api, { select: row2.id });
  expect(tableRow('月光草')).not.toHaveClass('rowflash');
  await user.click(screen.getByRole('button', { name: '승인' }));
  expect(api.calls).toContainEqual(['unit.setStatus', row2.id, 'approved']);
  const row = tableRow('맵1 · 이벤트1');
  expect(row).toHaveClass('rowflash');
  expect(pill(row)).toHaveClass('pop');
  // The row leaves the screen and comes back later (here: another screen and back): no second flash.
  motionClock.now = () => realNow() + 5000;
  act(() => { useApp.setView('settings'); });
  act(() => { useApp.setView('text'); });
  expect(tableRow('맵1 · 이벤트1')).not.toHaveClass('rowflash');
  expect(pill(tableRow('맵1 · 이벤트1'))).not.toHaveClass('pop');
});

test('고르기만 해서는 줄이 움직이지 않는다', async () => {
  const api = fakeApi({ rows: rowsWith(translated2) });
  const user = await openFakeWith(api);
  await user.click(screen.getByText('月光草'));
  await user.keyboard('{ArrowDown}{ArrowDown}');
  for (const r of screen.getAllByRole('row')) {
    expect(r).not.toHaveClass('rowflash');
    expect(r.querySelector('.pop')).toBeNull();
  }
});

test('번역 작업: 보낸 줄에 뼈대가 흐르고, 번역이 들어오면 한 번 밝아진다. 손으로 저장한 줄은 알약만 튄다', async () => {
  const api = fakeApi();
  await openFakeWith(api);
  api.emit('job:progress', job({ pending: [row2.id] }));
  let row = tableRow('맵1 · 이벤트1');
  expect(row).toHaveClass('busy');
  expect(row.querySelector('.skel')).not.toBeNull();
  changed(api, translated2);
  api.emit('job:progress', job({ done: 1 }));
  row = tableRow('맵1 · 이벤트1');
  expect(row).not.toHaveClass('busy');
  expect(row.querySelector('.skel')).toBeNull();
  expect(row).toHaveClass('rowflash');
  expect(pill(row)).toHaveClass('pop');

  api.emit('job:progress', job({ state: 'done', done: 2 }));
  changed(api, { ...baseRows[1], target: '월광초', status: 'translated' });
  const mine = tableRow('月光草');
  expect(mine).not.toHaveClass('rowflash');
  expect(pill(mine)).toHaveClass('pop');
});

test('비슷한 번역을 가져오면 번역 입력칸이 깜빡인다', async () => {
  const api = fakeApi();
  api.similarValue[errorRowId] = [{ id: 'r-old', source: '夜に光る石だ', target: '밤에 빛나는 돌이다', score: 61, location: '맵2 · 이벤트5' }];
  const user = await openFakeWith(api, { select: errorRowId });
  const box = screen.getByLabelText('번역');
  expect(box).not.toHaveClass('flash');
  const similar = within(await screen.findByRole('region', { name: '비슷한 번역' }));
  await user.click(similar.getByRole('button', { name: '가져오기' }));
  expect(box).toHaveValue('밤에 빛나는 돌이다');
  expect(box).toHaveClass('flash');
});

test('글자를 치는 동안에는 아무것도 움직이지 않는다', async () => {
  const api = fakeApi({ rows: rowsWith(translated2) });
  const user = await openFakeWith(api, { select: row2.id });
  await user.type(screen.getByLabelText('번역'), '가나다');
  expect(document.querySelectorAll('.flash, .shake, .pop, .rowflash')).toHaveLength(0);
});

test('오류가 새로 생기는 순간 검사 목록이 흔들린다. 오류 줄을 고르는 것만으로는 흔들리지 않는다', async () => {
  const mine: Row = { ...baseRows[1], target: '월광초', status: 'translated' };
  const api = fakeApi({ rows: rowsWith(mine) });
  await openFakeWith(api, { select: itemId });
  expect(checks()).not.toHaveClass('shake');
  api.rows = rowsWith({ ...mine, status: 'error' });
  changed(api, { ...mine, status: 'error' });
  await screen.findByText(/제어문자가 원문과 다릅니다/);
  expect(checks()).toHaveClass('shake');

  await act(async () => { await useApp.selectRow(errorRowId); });
  expect(checks()).not.toHaveClass('shake');
});

test('승인할 수 없으면 검사 목록이 흔들린다', async () => {
  const api = fakeApi({ rows: rowsWith(translated2) });
  api.unit.setStatus = async () => { throw new Error('오류가 있어 승인할 수 없어요'); };
  const user = await openFakeWith(api, { select: row2.id });
  await user.click(screen.getByRole('button', { name: '승인' }));
  expect(await screen.findByText('오류가 있어 승인할 수 없어요')).toBeVisible();
  expect(checks()).toHaveClass('shake');
  expect(tableRow('맵1 · 이벤트1')).not.toHaveClass('rowflash');
});

test('타이틀바: 작업 중에는 진행 줄에 빛이 흐르고, 패치 빌드 단추는 도는 표시 뒤 체크가 그려진다', async () => {
  const api = fakeApi();
  let finish!: () => void;
  const real = api.project.build;
  api.project.build = () => new Promise((resolve) => { finish = () => resolve(real()); });
  const user = await openFakeWith(api);
  const bar = screen.getByRole('banner');
  const line = bar.querySelector('.tb-progress')!;
  expect(line).not.toHaveClass('run');
  api.emit('job:progress', job({}));
  expect(line).toHaveClass('run');
  api.emit('job:progress', job({ state: 'paused' }));
  expect(line).not.toHaveClass('run');

  const build = within(bar).getByRole('button', { name: '패치 빌드' });
  await user.click(build);
  expect(build.querySelector('.spin')).not.toBeNull();
  expect(screen.getByText('패치를 만드는 중…')).toHaveClass('slide-down');
  await act(async () => { finish(); });
  await screen.findByText(/패치를 만들었습니다/);
  expect(build.querySelector('.spin')).toBeNull();
  expect(build.querySelector('svg.okd')).not.toBeNull();
});

test('왼쪽 메뉴와 오른쪽 탭의 강조 바탕은 따로 하나가 미끄러진다', async () => {
  const api = fakeApi();
  const user = await openFakeWith(api);
  expect(document.querySelectorAll('.sidebar > .nav-pill')).toHaveLength(1);
  const seg = screen.getByRole('tablist', { name: '오른쪽 탭' });
  const back = seg.querySelector<HTMLElement>('.seg-pill')!;
  expect(back.style.transform).toBe('none');
  await user.click(within(seg).getByRole('tab', { name: '채팅' }));
  expect(back.style.transform).toBe('translateX(100%)');
});
