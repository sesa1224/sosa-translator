// Shared parts every screen wears: switches, sliding pickers, grouped lists, callouts, empty states.
import { act, cleanup, screen, within } from '@testing-library/react';
import { type UserEvent } from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { useApp } from '../../src/renderer/state';
import type { DecisionGroup } from '../../src/shared/api';
import { fakeApi, openFakeWith, type FakeApi } from './fakeApi';

let api: FakeApi;
let user: UserEvent;

async function open(view: Parameters<typeof useApp.setView>[0], o: Parameters<typeof fakeApi>[0] = {}) {
  cleanup();
  api = fakeApi(o);
  user = await openFakeWith(api);
  act(() => { useApp.setView(view); });
}

test('켜고 끄는 설정은 스위치: 역할, 이름, 누르기와 스페이스', async () => {
  await open('settings');
  const sw = await screen.findByRole('switch', { name: '움직임 켜기' });
  expect(sw).toBeChecked();
  expect(sw).toHaveClass('sw');
  await user.click(sw);
  expect(api.calls).toContainEqual(['settings.set', { motion: false }]);
  sw.focus();
  await user.keyboard(' ');
  expect(api.calls.at(-1)).toEqual(['settings.set', { motion: true }]);
});

test('형식 규칙의 켜기·끄기도 스위치다', async () => {
  await open('glossary');
  const sw = await screen.findByRole('switch', { name: '제어 코드 유지' });
  expect(sw).toHaveClass('sw');
});

test('고르기: 바탕이 고른 단추 자리로 가고, 단추는 눌림 상태를 알린다', async () => {
  await open('text');
  const seg = screen.getByRole('group', { name: '보기 방식' });
  expect(seg).toHaveClass('seg', 'slide');
  expect(seg.querySelector('.th')).not.toBeNull();
  const story = within(seg).getByRole('button', { name: '스토리' });
  expect(story).toHaveAttribute('aria-pressed', 'false');
  story.focus();
  await user.keyboard('{Enter}');
  expect(story).toHaveAttribute('aria-pressed', 'true');
  expect(useApp.get().textMode).toBe('story');
  await user.click(within(seg).getByRole('button', { name: '표' }));
  expect(useApp.get().textMode).toBe('table');
});

test('텍스트 화면 머리: 큰 제목 옆 줄 수 배지, 내보내기·가져오기는 붙은 묶음', async () => {
  await open('text');
  const title = screen.getByRole('heading', { name: '텍스트' });
  expect(title).toHaveClass('page-title');
  const grp = screen.getByRole('button', { name: /내보내기/ }).closest('.grp');
  expect(grp).not.toBeNull();
  expect(within(grp as HTMLElement).getByRole('button', { name: '가져오기' })).toBeVisible();
  expect(document.querySelector('.cnt')?.textContent).toMatch(/줄$/);
});

test('용어집을 확정하지 않았으면 색 띠 안내와 바로 가는 단추', async () => {
  await open('text', { glossary: { confirmedAt: null } });
  const call = screen.getByText('용어집을 먼저 확정하세요').closest('.call');
  expect(call).not.toBeNull();
  await user.click(within(call as HTMLElement).getByRole('button', { name: '용어집으로' }));
  expect(useApp.get().view).toBe('glossary');
});

test('빈 화면은 그림 타일, 제목, 지금 있던 문구', async () => {
  await open('builds');
  const text = await screen.findByText('아직 빌드가 없어요. 위의 패치 빌드를 누르면 여기에 기록이 쌓여요.');
  const es = text.closest('.es');
  expect(es).not.toBeNull();
  expect(within(es as HTMLElement).getByRole('heading')).toBeVisible();
});

const groups: DecisionGroup[] = [
  { key: 'mv:D_TEXT', label: 'D_TEXT', kind: 'plugin-command', count: 2, samples: ['D_TEXT 筋力'], hints: { fileNames: 0 }, decision: null },
  { key: 'param:Menu:title', label: 'Menu · title', kind: 'plugin-param', count: 3, samples: ['記録'], hints: { fileNames: 0 },
    decision: { translate: true, keep: { mode: 'whole' }, status: 'confirmed', by: 'user' } },
];

test('판단 필요: 묶음은 한 판의 목록, 번역함·번역 안 함은 둘 중 하나, 정한 수의 진행 막대', async () => {
  cleanup();
  api = fakeApi();
  api.groupsValue = groups;
  user = await openFakeWith(api);
  act(() => { void useApp.openDecisions(); });
  await screen.findByRole('heading', { name: '판단 필요' });
  const cards = await screen.findAllByTestId('decision-card');
  expect(cards[0].closest('.list')).not.toBeNull();
  const done = within(cards[1]).getByRole('group', { name: 'Menu · title 번역 여부' });
  expect(within(done).getByRole('button', { name: '번역함' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(done).getByRole('button', { name: '번역 안 함' })).toHaveAttribute('aria-pressed', 'false');
  const bar = screen.getByRole('progressbar', { name: '정한 묶음' });
  expect(bar).toHaveAttribute('aria-valuenow', '1');
  expect(bar).toHaveAttribute('aria-valuemax', '2');
  expect(screen.getByText('1 / 2')).toBeVisible();
});
