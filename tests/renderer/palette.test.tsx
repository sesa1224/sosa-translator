import { act, screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { matchesQuery } from '../../src/renderer/commands';
import { useApp } from '../../src/renderer/state';
import type { Glossary, JobProgress } from '../../src/shared/api';
import { fakeApi, openFakeWith, updateFake, sampleSummary } from './fakeApi';

const confirmed: Partial<Glossary> = { confirmedAt: '2026-11-13T03:00:00.000Z' };
const job = (p: Partial<JobProgress>): JobProgress => ({ kind: 'translate', state: 'running', done: 0, total: 2, label: '', usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 }, declined: 0, errors: 0, ...p });
const palette = () => within(screen.getByRole('dialog', { name: '명령 검색' }));
const input = () => screen.getByRole('combobox', { name: '명령 검색어' });
const options = () => palette().getAllByRole('option');

test('Ctrl+K 로 열고 Esc 로 닫는다. 타이틀바의 검색 단추로도 연다', async () => {
  const api = fakeApi();
  const user = await openFakeWith(api);
  expect(screen.queryByRole('dialog', { name: '명령 검색' })).toBeNull();
  await user.keyboard('{Control>}k{/Control}');
  expect(input()).toHaveFocus();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog', { name: '명령 검색' })).toBeNull();
  await user.click(screen.getByRole('button', { name: '명령 검색 (Ctrl+K)' }));
  expect(input()).toHaveFocus();
});

test('바깥을 누르면 닫힌다', async () => {
  const api = fakeApi();
  const user = await openFakeWith(api);
  act(() => { useApp.openPalette(); });
  await user.click(document.querySelector('.veil')!);
  expect(screen.queryByRole('dialog', { name: '명령 검색' })).toBeNull();
});

test('왼쪽 메뉴의 화면이 모두 "가기" 명령으로 있다', async () => {
  const api = fakeApi();
  updateFake(api).summary = sampleSummary();
  const user = await openFakeWith(api);
  const nav = screen.getByRole('navigation', { name: '작업 메뉴' });
  await within(nav).findByRole('button', { name: /업데이트 결과/ });
  const names = [...nav.querySelectorAll('.nav-btn > span:first-of-type')].map((e) => e.textContent!);
  expect(names.length).toBeGreaterThanOrEqual(11);
  await user.keyboard('{Control>}k{/Control}');
  const labels = options().map((o) => o.textContent ?? '');
  for (const n of names) expect(labels.some((l) => l.startsWith(n) && l.includes('가기'))).toBe(true);
});

test('한글로 거르고 Enter 로 그 화면에 간다. 초성으로도 거른다', async () => {
  const api = fakeApi();
  const user = await openFakeWith(api);
  await user.keyboard('{Control>}k{/Control}');
  await user.type(input(), '용어');
  expect(options()[0]).toHaveTextContent('용어집으로 가기');
  await user.keyboard('{Enter}');
  expect(screen.queryByRole('dialog', { name: '명령 검색' })).toBeNull();
  expect(screen.getByRole('heading', { name: '용어집' })).toBeVisible();

  await user.keyboard('{Control>}k{/Control}');
  await user.type(input(), 'ㅅㅈ');
  expect(options().map((o) => o.textContent)).toEqual(expect.arrayContaining([expect.stringContaining('설정으로 가기')]));
  expect(matchesQuery('작업 기록으로 가기', 'ㅈㅇㄱㄹ')).toBe(true);
  expect(matchesQuery('작업 기록으로 가기', '기록')).toBe(true);
  expect(matchesQuery('작업 기록으로 가기', '용어')).toBe(false);
});

test('위아래 화살표로 고른다', async () => {
  const api = fakeApi();
  const user = await openFakeWith(api);
  await user.keyboard('{Control>}k{/Control}');
  await user.type(input(), '가기');
  expect(options()[0]).toHaveAttribute('aria-selected', 'true');
  await user.keyboard('{ArrowDown}');
  expect(options()[1]).toHaveAttribute('aria-selected', 'true');
  expect(input()).toHaveAttribute('aria-activedescendant', options()[1].id);
  await user.keyboard('{ArrowUp}{ArrowUp}');
  expect(options()[0]).toHaveAttribute('aria-selected', 'true');
});

test('표 거르기: 오류 있는 줄만 보기', async () => {
  const api = fakeApi();
  const user = await openFakeWith(api);
  act(() => { useApp.setView('glossary'); });
  await user.keyboard('{Control>}k{/Control}');
  await user.type(input(), '오류');
  await user.click(palette().getByRole('option', { name: /오류 있는 줄만 보기/ }));
  expect(screen.getByRole('button', { name: /^오류 \d/ })).toHaveAttribute('aria-pressed', 'true');
});

test('친 글자로 문장 찾기: 텍스트 화면의 찾기 칸에 넣는다', async () => {
  const api = fakeApi();
  const user = await openFakeWith(api);
  act(() => { useApp.setView('settings'); });
  await user.keyboard('{Control>}k{/Control}');
  await user.type(input(), '月光');
  expect(options()[0]).toHaveTextContent('문장 찾기: 月光');
  await user.keyboard('{Enter}');
  expect(screen.getByLabelText('문장 검색')).toHaveValue('月光');
  expect(useApp.get().query.text).toBe('月光');
  const table = screen.getByRole('table', { name: '텍스트 표' });
  expect(within(table).getByText('月光草')).toBeVisible();
  expect(within(table).queryByText('やった！')).toBeNull();
});

test('지금 할 수 없는 명령은 흐리고 이유를 적으며, 눌러도 아무것도 하지 않는다', async () => {
  const api = fakeApi({ glossary: confirmed });
  const user = await openFakeWith(api);
  api.emit('job:progress', job({}));
  await user.keyboard('{Control>}k{/Control}');
  await user.type(input(), '번역하기');
  const opt = palette().getByRole('option', { name: /미번역 줄 번역하기/ });
  expect(opt).toHaveAttribute('aria-disabled', 'true');
  expect(opt).toHaveTextContent('다른 작업이 진행 중이에요');
  await user.click(opt);
  await user.keyboard('{Enter}');
  expect(api.calls.some((c) => c[0] === 'job.translate')).toBe(false);
  expect(screen.getByRole('dialog', { name: '명령 검색' })).toBeVisible();
});

test('동작: 미번역 줄 번역하기, 검수, 패치 빌드, 새 버전 가져오기', async () => {
  const api = fakeApi({ glossary: confirmed });
  const user = await openFakeWith(api);
  const run = async (q: string, name: RegExp) => {
    await user.keyboard('{Control>}k{/Control}');
    await user.type(input(), q);
    await user.click(palette().getByRole('option', { name }));
  };
  await run('미번역', /미번역 줄 번역하기/);
  expect(api.calls).toContainEqual(['job.translate', undefined]);
  await run('검수', /번역 전체 검수/);
  expect(screen.getByRole('dialog', { name: '번역 전체 검수' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: '취소' }));
  await run('빌드', /패치 빌드/);
  expect(api.calls).toContainEqual(['project.build']);
  await run('새 버전', /새 버전 가져오기/);
  expect(useApp.get().updateOpen).toBe(true);
});
