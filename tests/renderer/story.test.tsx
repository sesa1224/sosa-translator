import { act, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { useApp } from '../../src/renderer/state';
import type { Row, SceneInfo } from '../../src/shared/api';
import { baseRows, fakeApi, openFakeWith, previewFake, type FakeApi } from './fakeApi';

const MAP = 'data/Map001.json';
const patch = (id: string, p: Partial<Row>) => baseRows.map((r) => (r.id === id ? { ...r, ...p } : r));

function rowsWith(changes: Record<string, Partial<Row>>): Row[] {
  let rows = baseRows;
  for (const [id, p] of Object.entries(changes)) rows = rows.map((r) => (r.id === id ? { ...r, ...p } : r));
  return rows;
}

const scene = (p: Partial<SceneInfo> = {}): SceneInfo => ({
  key: `${MAP}#events/1/pages/0`, file: MAP, label: '맵1 · 이벤트1', condition: '스위치 12 [森の入口到着] 켜짐',
  lines: [
    { id: 'r-map-1', kind: 'dialogue', order: 1, speaker: 'リナ' },
    { id: 'r-choice-1', kind: 'choice', order: 3.001, speaker: null, choiceGroup: 3 },
    { id: 'r-choice-2', kind: 'choice', order: 3.002, speaker: null, choiceGroup: 3 },
    { id: 'r-map-2', kind: 'dialogue', order: 6, speaker: 'リナ' },
  ],
  ...p,
});

let api: FakeApi;
beforeEach(() => {
  api = fakeApi({ rows: patch('r-map-1', { target: '어라? \\N[1] 아니야!\n이런 밤에 오다니', status: 'needs-review' }), glossary: { confirmedAt: '2026-11-13T00:00:00.000Z' } });
  previewFake(api).scenes = { [MAP]: [scene()] };
});

async function openStory(o: { file?: string } = {}) {
  const user = await openFakeWith(api);
  await user.click(screen.getByRole('button', { name: '스토리' }));
  if (o.file) act(() => { useApp.toggleScope(o.file!); });
  return user;
}

test('표와 스토리를 바꾸고, 범위를 고르지 않았으면 안내', async () => {
  const user = await openFakeWith(api);
  expect(screen.getByRole('table', { name: '텍스트 표' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '스토리' }));
  expect(useApp.get().textMode).toBe('story');
  expect(screen.getByRole('button', { name: '스토리' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('table', { name: '텍스트 표' })).toBeNull();
  expect(screen.getByText('왼쪽에서 범위를 고르면 장면이 나와요')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '표' }));
  expect(screen.getByRole('table', { name: '텍스트 표' })).toBeInTheDocument();
});

test('장면 머리에 라벨, 조건, 진행이 있고 줄을 누르면 선택된다', async () => {
  const user = await openStory({ file: MAP });
  const head = await screen.findByText('맵1 · 이벤트1');
  const card = head.closest('section')!;
  expect(within(card).getByText('조건: 스위치 12 [森の入口到着] 켜짐')).toBeVisible();
  expect(within(card).getByText('번역 1 / 4')).toBeVisible();
  expect(api.calls).toContainEqual(['story.scenes', MAP]);
  expect(within(card).getAllByText('번역 전').length).toBe(3);
  await user.click(within(card).getByText('こんな夜に来るなんて', { exact: false }));
  expect(useApp.get().selectedId).toBe('r-map-1');
  await waitFor(() => expect(card.querySelector('[data-id="r-map-1"]')).toHaveClass('sel'));
});

test('선택지 두 개가 한 묶음 안에 나란히', async () => {
  await openStory({ file: MAP });
  const a = await screen.findByText('いいよ');
  const b = screen.getByText('また今度');
  const group = a.closest('.story-choices')!;
  expect(group).not.toBeNull();
  expect(group.contains(b)).toBe(true);
  expect(group.querySelectorAll('.story-choice')).toHaveLength(2);
});

test('장면 승인은 번역이 있고 오류가 아닌 항목만, 다시 번역은 장면의 id 들로', async () => {
  api.rows = rowsWith({
    'r-map-1': { target: '어라?', status: 'needs-review' },
    'r-choice-1': { target: '좋아', status: 'needs-review' },
    'r-map-2': { target: '해냈다', status: 'error' },
  });
  const user = await openStory({ file: MAP });
  await screen.findByText('맵1 · 이벤트1');
  await user.click(screen.getByRole('button', { name: '장면 승인' }));
  const approved = api.calls.filter((c) => c[0] === 'unit.setStatus');
  expect(approved).toEqual([['unit.setStatus', 'r-map-1', 'approved'], ['unit.setStatus', 'r-choice-1', 'approved']]);
  await user.click(screen.getByRole('button', { name: '이 장면 다시 번역' }));
  expect(api.calls).toContainEqual(['job.translate', ['r-map-1', 'r-choice-1', 'r-choice-2', 'r-map-2']]);
});

test('승인할 대상이 없으면 장면 승인을 누를 수 없다', async () => {
  api.rows = baseRows;
  await openStory({ file: MAP });
  await screen.findByText('맵1 · 이벤트1');
  expect(screen.getByRole('button', { name: '장면 승인' })).toBeDisabled();
});

test('상태 필터 미번역이면 미번역 줄이 없는 장면이 사라진다', async () => {
  api.rows = rowsWith({
    'r-map-1': { target: '어라?', status: 'needs-review' },
    'r-map-2': { target: '해냈다', status: 'needs-review' },
  });
  previewFake(api).scenes = {
    [MAP]: [
      scene({ key: 'a', label: '맵1 · 이벤트1', lines: [{ id: 'r-map-1', kind: 'dialogue', order: 1, speaker: 'リナ' }, { id: 'r-map-2', kind: 'dialogue', order: 6, speaker: 'リナ' }] }),
      scene({ key: 'b', label: '맵1 · 이벤트2', condition: null, lines: [{ id: 'r-choice-1', kind: 'choice', order: 3.001, speaker: null, choiceGroup: 3 }] }),
    ],
  };
  const user = await openStory({ file: MAP });
  expect(await screen.findByText('맵1 · 이벤트1')).toBeVisible();
  expect(screen.getByText('맵1 · 이벤트2')).toBeVisible();
  await user.click(screen.getByRole('button', { name: /미번역/ }));
  await waitFor(() => expect(screen.queryByText('맵1 · 이벤트1')).toBeNull());
  expect(screen.getByText('맵1 · 이벤트2')).toBeVisible();
});
