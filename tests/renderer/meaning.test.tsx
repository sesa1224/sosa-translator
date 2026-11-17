// Meaning colours on the screen: a passed check and the menu counts (the tokens themselves: tests/shared/themeColors.test.ts).
import { act, cleanup, screen, within } from '@testing-library/react';
import { expect, test } from 'vitest';
import { useApp } from '../../src/renderer/state';
import { errorRowId, fakeApi, itemId, openFakeWith, row1 } from './fakeApi';

test('검사 통과는 ok 색', async () => {
  cleanup();
  const api = fakeApi({ rows: [{ ...row1, target: '리나', status: 'translated' }] });
  await openFakeWith(api, { select: row1.id });
  const checks = screen.getByRole('group', { name: '검사' });
  expect(within(checks).getByText(/통과/)).toHaveClass('ok-text');
});

test('왼쪽 메뉴의 수 배지는 뜻 색: 미번역 수는 흐리게, 판단 필요는 경고색', async () => {
  cleanup();
  const api = fakeApi();
  await openFakeWith(api);
  act(() => { useApp.setView('text'); });
  const nav = screen.getByRole('navigation', { name: '작업 메뉴' });
  const text = within(nav).getByRole('button', { name: /텍스트/ });
  expect(text.querySelector('.nb')).toHaveClass('nb-mute');
  const decisions = within(nav).getByRole('button', { name: /판단 필요/ });
  expect(decisions.querySelector('.nb')).toHaveClass('nb-warn');
  void itemId; void errorRowId;
});
