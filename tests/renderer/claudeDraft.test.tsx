import { screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import type { Glossary, JobProgress, LineDraft } from '../../src/shared/api';
import { errorRowId, fakeApi, itemId, openFakeWith } from './fakeApi';

const confirmed: Partial<Glossary> = { confirmedAt: '2026-11-13T03:00:00.000Z' };
const job = (p: Partial<JobProgress>): JobProgress => ({ kind: 'translate', state: 'running', done: 0, total: 2, label: '맵1 (1/1)', usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 }, declined: 0, errors: 0, ...p });

test('Claude 초안은 줄을 고를 때 저절로 받지 않고, 눌렀을 때만 받아 목록에 보인다', async () => {
  const api = fakeApi({ glossary: confirmed });
  const user = await openFakeWith(api, { select: itemId });
  await screen.findByLabelText('번역');
  expect(api.calls.some((c) => c[0] === 'unit.claudeDraft')).toBe(false);
  await user.click(screen.getByRole('button', { name: 'Claude 초안 받기' }));
  expect(api.calls).toContainEqual(['unit.claudeDraft', itemId]);
  const box = within(await screen.findByRole('region', { name: '비슷한 번역' }));
  expect(box.getByText('Claude 초안')).toBeVisible();
  expect(box.getByText('Claude가 옮긴 줄')).toBeVisible();
});

test('Claude 초안의 가져오기는 번역 칸만 바꾸고 저장하지 않는다. 쓴 토큰은 사용량 표시에 더한다', async () => {
  const api = fakeApi({ glossary: confirmed });
  const user = await openFakeWith(api, { select: itemId });
  await user.click(await screen.findByRole('button', { name: 'Claude 초안 받기' }));
  const box = within(await screen.findByRole('region', { name: '비슷한 번역' }));
  await user.click(box.getByRole('button', { name: '가져오기' }));
  expect(screen.getByLabelText('번역')).toHaveValue('Claude가 옮긴 줄');
  expect(api.calls.some((c) => c[0] === 'unit.setTranslation')).toBe(false);
  // input + cache read + cache create, as the status bar counts the chat's.
  expect(screen.getByText('입력 1,500 · 출력 80 토큰')).toBeVisible();
});

test('비슷한 번역과 Claude 초안이 한 묶음에 같이 보인다', async () => {
  const api = fakeApi({ glossary: confirmed });
  api.similarValue[errorRowId] = [{ id: 'r-old', source: '夜に光る花', target: '밤에 빛나는 꽃', score: 70, location: 'Items · 7' }];
  const user = await openFakeWith(api, { select: errorRowId });
  const box = within(await screen.findByRole('region', { name: '비슷한 번역' }));
  await user.click(box.getByRole('button', { name: 'Claude 초안 받기' }));
  await box.findByText('Claude가 옮긴 줄');
  expect(box.getAllByRole('button', { name: '가져오기' })).toHaveLength(2);
});

test('다른 줄을 고르면 받은 초안은 사라진다', async () => {
  const api = fakeApi({ glossary: confirmed });
  const user = await openFakeWith(api, { select: itemId });
  await user.click(await screen.findByRole('button', { name: 'Claude 초안 받기' }));
  await screen.findByText('Claude가 옮긴 줄');
  await user.click(screen.getByText('やった！'));
  await screen.findByRole('button', { name: 'Claude 초안 받기' });
  expect(screen.queryByText('Claude가 옮긴 줄')).toBeNull();
});

test('용어집을 확정하기 전에는 단추가 막힌다', async () => {
  const api = fakeApi();
  await openFakeWith(api, { select: itemId });
  const btn = await screen.findByRole('button', { name: 'Claude 초안 받기' });
  expect(btn).toBeDisabled();
  expect(btn).toHaveAttribute('title', expect.stringContaining('용어집을 먼저 확정하세요'));
});

test('다른 작업이 도는 중에는 단추가 막힌다', async () => {
  const api = fakeApi({ glossary: confirmed });
  await openFakeWith(api, { select: itemId });
  api.emit('job:progress', job({}));
  const btn = await screen.findByRole('button', { name: 'Claude 초안 받기' });
  expect(btn).toBeDisabled();
  expect(btn).toHaveAttribute('title', expect.stringContaining('다른 작업이 진행 중이에요'));
});

test('받지 못하면 이유를 그 자리에 보인다', async () => {
  const api = fakeApi({ glossary: confirmed });
  api.claudeDraft = (): LineDraft => ({ text: null, reason: '모델이 번역을 거절했습니다', usage: { input: 10, output: 0, cacheRead: 0, cacheCreate: 0 } });
  const user = await openFakeWith(api, { select: itemId });
  await user.click(await screen.findByRole('button', { name: 'Claude 초안 받기' }));
  expect(await screen.findByText(/초안을 받지 못했어요 · 모델이 번역을 거절했습니다/)).toBeVisible();
  api.claudeDraft = () => { throw new Error('다른 작업이 진행 중입니다'); };
  await user.click(screen.getByRole('button', { name: 'Claude 초안 받기' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('다른 작업이 진행 중입니다');
});

test('판단 필요 줄에는 단추가 없다', async () => {
  const api = fakeApi({ glossary: confirmed });
  await openFakeWith(api, { select: 'r-cmd' });
  await screen.findByLabelText('번역');
  expect(screen.queryByRole('button', { name: 'Claude 초안 받기' })).toBeNull();
});
