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

  // The newest build is the large one: its numbers and scopes are readable without opening anything.
  const latest = cards[0];
  expect(latest).toHaveAccessibleName('빌드 4');
  expect(within(latest).getByText('최신 패치')).toBeVisible();
  expect(within(latest).getByRole('heading', { name: '빌드 4' })).toBeVisible();
  expect(within(latest).getByText(/2026-11-13 \d\d:40/)).toBeVisible();
  const stat = (label: string) => within(latest).getByText(label).closest('.bv-stat') as HTMLElement;
  expect(within(stat('새 번역')).getByText('137')).toBeVisible();
  expect(within(stat('고친 번역')).getByText('12')).toBeVisible();
  expect(within(stat('그림')).getByText('1')).toBeVisible();
  expect(within(stat('파일')).getByText('24')).toBeVisible();
  expect(within(latest).getByText('맵2')).toBeVisible();

  // The notes are read first; the edit box appears only after asking for it.
  expect(within(latest).getByText('약초원 한국어 패치 빌드 4')).toBeVisible();
  expect(within(latest).queryByLabelText('빌드 4 패치노트')).toBeNull();
  await user.click(within(latest).getByRole('button', { name: '패치노트 고치기' }));
  const box = within(latest).getByLabelText('빌드 4 패치노트');
  await user.clear(box);
  await user.type(box, '고친 노트');
  await user.click(within(latest).getByRole('button', { name: /Claude에게 다듬기 맡기기/ }));
  expect(api.calls).toContainEqual(['builds.polishNotes', 4]);
  expect(within(latest).getByText(/claude-haiku-5-5|Claude Haiku 5\.5/)).toBeVisible();
  await user.click(within(latest).getByRole('button', { name: '저장' }));
  expect(api.calls).toContainEqual(['builds.setNotes', 4, '고친 노트']);
  await waitFor(() => expect(within(latest).queryByLabelText('빌드 4 패치노트')).toBeNull());
  expect(within(latest).getByText('고친 노트')).toBeVisible();

  await user.click(within(latest).getByRole('button', { name: '폴더 열기' }));
  expect(api.calls).toContainEqual(['builds.openFolder', 4]);

  await user.click(within(latest).getByText('바뀐 파일 2개'));
  await waitFor(() => expect(within(latest).getByText('img/pictures/menu.png')).toBeVisible());
  expect(within(latest).getByText('data/Map002.json')).toBeVisible();

  // Older builds are one line each until opened.
  const older = cards[1];
  expect(older).toHaveAccessibleName('빌드 3');
  expect(within(older).queryByRole('button', { name: '폴더 열기' })).toBeNull();
  await user.click(within(older).getByRole('button', { name: /빌드 3/ }));
  await user.click(within(older).getByRole('button', { name: '폴더 열기' }));
  expect(api.calls).toContainEqual(['builds.openFolder', 3]);
  expect(within(older).getByRole('button', { name: '패치노트 고치기' })).toBeVisible();
});

test('빌드가 하나뿐이면 이전 빌드 묶음이 없다', async () => {
  imagesFake(api).builds = [record(1)];
  await openBuilds();
  expect(await screen.findAllByRole('article')).toHaveLength(1);
  expect(screen.queryByRole('heading', { name: '이전 빌드' })).toBeNull();
  expect(screen.getByText('이 빌드는 바뀐 점 기록이 없어요')).toBeVisible();
});
