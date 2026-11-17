import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import type { ImageEntry } from '../../src/shared/api';
import { useApp } from '../../src/renderer/state';
import { defaultRegion, fakeApi, imagesFake, openFakeWith, type FakeApi } from './fakeApi';

const entry = (file: string, p: Partial<ImageEntry> = {}): ImageEntry => ({
  file, sourceFile: file, encrypted: false, width: 400, height: 200, bytes: 100, hash: 'h', usedByEvents: 0, status: 'none', ...p,
});
const MENU = 'img/pictures/menu.png';

let api: FakeApi;
beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:fake');
  URL.revokeObjectURL = vi.fn();
  api = fakeApi();
  const im = imagesFake(api);
  im.entries = [
    entry(MENU, { status: 'todo', usedByEvents: 3 }),
    entry('img/pictures/logo.png', { status: 'done' }),
    entry('img/titles1/title.png'),
    entry('img/system/skip.png', { status: 'skip' }),
    entry('img/pictures/old.png', { status: 'done', problem: 'base-changed' }),
  ];
  im.recipes[MENU] = {
    file: MENU, baseHash: 'h', status: 'todo',
    regions: [{ ...defaultRegion(), id: 'r0', rect: { x: 10, y: 10, w: 100, h: 40 }, text: '메뉴', source: 'メニュー' }, { ...defaultRegion(), id: 'r1', rect: { x: 10, y: 80, w: 100, h: 40 }, text: '끝' }],
  };
  im.recipes['img/pictures/old.png'] = { file: 'img/pictures/old.png', baseHash: 'x', status: 'done', regions: [] };
});

async function openImages() {
  const user = await openFakeWith(api);
  await user.click(within(screen.getByRole('navigation', { name: '작업 메뉴' })).getByRole('button', { name: /^이미지/ }));
  await screen.findByRole('heading', { name: '이미지' });
  return user;
}

const grid = () => screen.getByRole('list', { name: '그림 목록' });
/** A status filter: its name is the status and how many pictures have it. */
const chip = (label: string) => within(screen.getByRole('group', { name: '그림 거르기' })).getByRole('button', { name: new RegExp(`^${label} \\d`) });
const cells = () => within(grid()).queryAllByRole('button').map((b) => b.getAttribute('data-file'));
const recipeCalls = () => api.calls.filter((c) => c[0] === 'images.setRecipe');
const lastRegions = () => recipeCalls().at(-1)![2] as any[];

async function pick(user: Awaited<ReturnType<typeof openImages>>, file = MENU) {
  await user.click(within(grid()).getByRole('button', { name: new RegExp(file.split('/').pop()!.replace('.', '\\.')) }));
  await screen.findByRole('img', { name: '원본' });
}

test('사이드바 숫자는 할 것 수, 필터 칩이 격자를 거른다', async () => {
  const user = await openFakeWith(api);
  const nav = within(screen.getByRole('navigation', { name: '작업 메뉴' }));
  await waitFor(() => expect(nav.getByRole('button', { name: /^이미지/ })).toHaveTextContent('이미지1'));
  await user.click(nav.getByRole('button', { name: /^이미지/ }));
  await screen.findByRole('heading', { name: '이미지' });
  await waitFor(() => expect(cells()).toHaveLength(5));
  await user.click(chip('할 것'));
  expect(cells()).toEqual([MENU]);
  // Each status count carries its meaning colour.
  expect(chip('할 것')).toHaveClass('warn');
  expect(chip('끝남')).toHaveClass('ok');
  expect(chip('문제 있음')).toHaveClass('err');
  expect(within(grid()).getByText('할 것')).toHaveClass('st-warn');
  await user.click(chip('끝남'));
  expect(cells()).toEqual(['img/pictures/logo.png', 'img/pictures/old.png']);
  await user.click(chip('건너뜀'));
  expect(cells()).toEqual(['img/system/skip.png']);
  await user.click(chip('안 본 것'));
  expect(cells()).toEqual(['img/titles1/title.png']);
  await user.click(chip('문제 있음'));
  expect(cells()).toEqual(['img/pictures/old.png']);
  await user.click(chip('전체'));
  expect(within(grid()).getByText('이벤트 3곳')).toBeVisible();
});

test('그림을 고르면 원본과 번역본, 영역 번호가 보인다', async () => {
  const user = await openImages();
  await pick(user);
  expect(screen.getByRole('img', { name: '원본' })).toBeVisible();
  expect(screen.getByRole('img', { name: '번역본' })).toBeVisible();
  expect(screen.getByText('선택한 글자 영역 1 / 2')).toBeVisible();
  expect(screen.getByText('メニュー')).toBeVisible();
});

test('문장을 바꾸면 300ms 뒤 한 번 저장된다', async () => {
  const user = await openImages();
  await pick(user);
  const box = screen.getByLabelText('문장');
  await user.clear(box);
  await user.type(box, '이야기');
  expect(recipeCalls()).toHaveLength(0);
  await waitFor(() => expect(recipeCalls()).toHaveLength(1), { timeout: 2000 });
  await new Promise((r) => setTimeout(r, 400));
  expect(recipeCalls()).toHaveLength(1);
  expect(recipeCalls()[0][1]).toBe(MENU);
  expect(lastRegions()[0].text).toBe('이야기');
  expect(lastRegions()[1].text).toBe('끝');
});

test('크기, 정렬, 지우기 방식이 각각 그 값으로 저장된다', async () => {
  const user = await openImages();
  await pick(user);
  fireEvent.change(screen.getByLabelText('크기 조절'), { target: { value: '40' } });
  await waitFor(() => expect((recipeCalls().at(-1) as any)?.[2]?.[0]?.size).toBe(40));
  await user.click(screen.getByRole('button', { name: '오른쪽' }));
  await waitFor(() => expect(lastRegions()[0].align).toBe('right'));
  await user.click(screen.getByRole('button', { name: '아래' }));
  await waitFor(() => expect(lastRegions()[0].valign).toBe('bottom'));
  await user.selectOptions(screen.getByLabelText('지우기 방식'), 'fill');
  await waitFor(() => expect(lastRegions()[0].erase).toBe('fill'));
});

test('원본 위에서 끌면 그림 좌표로 바꾼 영역이 더해진다', async () => {
  const user = await openImages();
  await pick(user);
  const ov = screen.getByLabelText('원본 위에서 끌어 영역 만들기');
  // The 400×200 picture is shown at half size.
  ov.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, toJSON() { return this; } }) as DOMRect;
  fireEvent.mouseDown(ov, { clientX: 10, clientY: 10, button: 0 });
  fireEvent.mouseMove(window, { clientX: 60, clientY: 40 });
  fireEvent.mouseUp(window, { clientX: 60, clientY: 40 });
  await waitFor(() => expect(recipeCalls().length).toBeGreaterThan(0), { timeout: 2000 });
  expect(lastRegions()).toHaveLength(3);
  expect(lastRegions()[2].rect).toEqual({ x: 20, y: 20, w: 100, h: 60 });
  expect(screen.getByText('선택한 글자 영역 3 / 3')).toBeVisible();
});

test('끝남으로 표시와 건너뛰기', async () => {
  const user = await openImages();
  await pick(user);
  await user.click(screen.getByRole('button', { name: '끝남으로 표시' }));
  expect(api.calls).toContainEqual(['images.setStatus', MENU, 'done']);
  await user.click(screen.getByRole('button', { name: '건너뛰기' }));
  expect(api.calls).toContainEqual(['images.setStatus', MENU, 'skip']);
});

test('원본이 바뀐 그림에는 안내와 확인 버튼', async () => {
  const user = await openImages();
  await pick(user, 'img/pictures/old.png');
  expect(screen.getByText('원본 그림이 바뀌었어요. 지시서가 맞는지 확인하세요')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '확인했어요' }));
  expect(api.calls).toContainEqual(['images.acceptBase', 'img/pictures/old.png']);
});

test('글이 영역을 넘치면 알린다', async () => {
  imagesFake(api).overflow[MENU] = { r0: { overflowX: true, overflowY: false } };
  const user = await openImages();
  await pick(user);
  expect(await screen.findByText('영역을 넘쳐요')).toBeVisible();
});

test('원본 내보내기: 고른 그림 한 장, 또는 보이는 그림 전부', async () => {
  const user = await openImages();
  await waitFor(() => expect(cells()).toHaveLength(5));
  await user.click(chip('할 것'));
  imagesFake(api).exportFailed = 0;
  await user.click(screen.getByRole('button', { name: '보이는 원본 1장 내보내기' }));
  expect(api.calls).toContainEqual(['images.exportOriginals', [MENU]]);
  expect(await screen.findByText('원본 1장을 내보냈어요: C:\\내보낸 그림')).toBeVisible();

  await user.click(chip('전체'));
  imagesFake(api).exportFailed = 2;
  await user.click(screen.getByRole('button', { name: '보이는 원본 5장 내보내기' }));
  expect(api.calls.at(-1)).toEqual(['images.exportOriginals', cells()]);
  expect(await screen.findByText('원본 3장을 내보냈어요: C:\\내보낸 그림 · 실패 2장')).toBeVisible();

  imagesFake(api).exportFailed = 0;
  await pick(user);
  await user.click(screen.getByRole('button', { name: '원본 내보내기' }));
  expect(api.calls.at(-1)).toEqual(['images.exportOriginals', [MENU]]);
  expect(await screen.findByText('원본 1장을 내보냈어요: C:\\내보낸 그림')).toBeVisible();
});

test('원본 내보내기: 고르지 않으면 아무것도 안 보이고, 보이는 그림이 없으면 막힌다', async () => {
  imagesFake(api).exportDir = null;
  const user = await openImages();
  await waitFor(() => expect(cells()).toHaveLength(5));
  await user.click(screen.getByRole('button', { name: '보이는 원본 5장 내보내기' }));
  expect(api.calls).toContainEqual(['images.exportOriginals', cells()]);
  expect(screen.queryByText(/내보냈어요/)).toBeNull();
  await user.selectOptions(screen.getByLabelText('폴더'), 'img/system');
  await user.click(chip('할 것'));
  expect(screen.getByRole('button', { name: '보이는 원본 0장 내보내기' })).toBeDisabled();
});

test('채팅으로 말하기는 그림을 붙여 채팅 탭으로 간다', async () => {
  const user = await openImages();
  await pick(user);
  await user.click(screen.getByRole('button', { name: '채팅으로 말하기' }));
  expect(useApp.get().rightTab).toBe('chat');
  expect(await screen.findByText(`이미지: ${MENU}`)).toBeVisible();
  await act(async () => { await useApp.sendChat('이 그림 봐줘', []); });
  const sent = api.calls.find((c) => c[0] === 'chat.send')!;
  expect(String(sent[1]).startsWith(`[이미지] file=${MENU}`)).toBe(true);
});
