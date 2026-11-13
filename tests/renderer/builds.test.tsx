import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import type { BuildRecord } from '../../src/shared/api';
import { fakeApi, imagesFake, openFakeWith, type FakeApi } from './fakeApi';

const record = (number: number, p: Partial<BuildRecord> = {}): BuildRecord => ({
  number, createdAt: `2026-11-13T1${number}:40:00.000Z`, zipPath: `C:/p/builds/00${number}/x.zip`, files: 20 + number,
  notes: `약초원 한국어 패치 빌드 ${number}\n- 새 번역 ${number}줄`, diff: null, ...p,
});

let api: FakeApi;
beforeEach(() => {
  api = fakeApi();
});

async function openBuilds() {
  const user = await openFakeWith(api);
  await user.click(within(screen.getByRole('navigation', { name: '작업 메뉴' })).getByRole('button', { name: '빌드 기록' }));
  await screen.findByRole('heading', { name: '빌드 기록' });
  return user;
}

test('빌드가 없으면 안내', async () => {
  await openBuilds();
  expect(await screen.findByText('아직 빌드가 없어요. 위의 패치 빌드를 누르면 여기에 기록이 쌓여요.')).toBeVisible();
});

test('카드는 최신순, 노트를 고쳐 저장하고 다듬기를 맡긴다', async () => {
  imagesFake(api).builds = [
    record(4, {
      diff: {
        number: 4, previous: 3, newTranslations: 137, changedTranslations: 12, removedTranslations: 0,
        byScope: [{ label: '맵2', added: 100, changed: 2 }], newImages: ['img/pictures/menu.png'], changedImages: [], addedFiles: ['data/Map002.json'], removedFiles: [], extras: {},
      },
    }),
    record(3),
  ];
  const user = await openBuilds();
  const cards = await screen.findAllByRole('article');
  expect(cards).toHaveLength(2);
  expect(within(cards[0]).getByText(/^빌드 4 · 2026-11-13 \d\d:40 · 파일 24개$/)).toBeVisible();
  expect(within(cards[1]).getByText(/^빌드 3 · /)).toBeVisible();

  const box = within(cards[0]).getByLabelText('빌드 4 패치노트');
  await user.clear(box);
  await user.type(box, '고친 노트');
  await user.click(within(cards[0]).getByRole('button', { name: '저장' }));
  expect(api.calls).toContainEqual(['builds.setNotes', 4, '고친 노트']);

  await user.click(within(cards[0]).getByRole('button', { name: /Claude에게 다듬기 맡기기/ }));
  expect(api.calls).toContainEqual(['builds.polishNotes', 4]);
  expect(within(cards[0]).getByText(/claude-haiku-5-5|Claude Haiku 5\.5/)).toBeVisible();

  await user.click(within(cards[0]).getByRole('button', { name: '폴더 열기' }));
  expect(api.calls).toContainEqual(['builds.openFolder', 4]);

  await user.click(within(cards[0]).getByText('바뀐 점 자세히'));
  await waitFor(() => expect(within(cards[0]).getByText('새 번역 137')).toBeVisible());
  expect(within(cards[0]).getByText('고친 번역 12')).toBeVisible();
  expect(within(cards[0]).getByText('맵2')).toBeVisible();
  expect(within(cards[0]).getByText('img/pictures/menu.png')).toBeVisible();
  expect(within(cards[0]).getByText('data/Map002.json')).toBeVisible();
});
