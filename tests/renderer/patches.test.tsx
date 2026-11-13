import { act, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { eventActions, useApp } from '../../src/renderer/state';
import type { Patch } from '../../src/shared/api';
import { eventsFake, fakeApi, openFakeWith, previewFake, type FakeApi } from './fakeApi';

const MAP = 'data/Map003.json';
const base = { note: '', originalBug: false, createdBy: 'user' as const, createdAt: '' };
const PATCHES: Patch[] = [
  { ...base, id: 'p1', title: '이벤트2로 넘어가게 하기', enabled: true, originalBug: true,
    body: { kind: 'event', file: MAP, listPath: ['events', 12, 'pages', 1, 'list'], baseHash: 'h', ops: [{ op: 'insert', after: 3, commands: [{ code: 121, indent: 0, parameters: [45, 45, 0] }] }] } },
  { ...base, id: 'p2', title: '글자 크기', enabled: false, body: { kind: 'json', file: 'data/System.json', path: ['advanced', 'fontSize'], baseValue: 26, value: 22 } },
  { ...base, id: 'p3', title: '자료실 버그', enabled: true,
    body: { kind: 'event', file: 'data/CommonEvents.json', listPath: [4, 'list'], baseHash: 'h', ops: [{ op: 'delete', at: 0 }] } },
];

let api: FakeApi;
beforeEach(() => {
  api = fakeApi();
  const ev = eventsFake(api);
  ev.patches = PATCHES;
  ev.statuses = [{ id: 'p1', state: 'applied' }, { id: 'p2', state: 'disabled' }, { id: 'p3', state: 'conflict', reason: '원본 이벤트가 기록했을 때와 달라졌어요' }];
  ev.report = '# 약초원 원본 버그 수정 목록\n\n## 1. 이벤트2로 넘어가게 하기';
});

async function openPatches() {
  const user = await openFakeWith(api);
  await user.click(await screen.findByRole('button', { name: /^수정 내역/ }));
  await screen.findByRole('heading', { name: '수정 내역' });
  return user;
}
const rowOf = (title: string) => screen.getByDisplayValue(title).closest('[data-patch]') as HTMLElement;

test('사이드바에 수정 수, 목록에 세 가지 상태 칩과 충돌 이유', async () => {
  await openPatches();
  expect(screen.getByRole('button', { name: /^수정 내역/ })).toHaveTextContent('3');
  expect(within(rowOf('이벤트2로 넘어가게 하기')).getByText('적용됨')).toBeInTheDocument();
  expect(within(rowOf('이벤트2로 넘어가게 하기')).getByText('맵3 이벤트12 2페이지 · 줄 1개 추가')).toBeInTheDocument();
  expect(within(rowOf('글자 크기')).getByText('꺼짐')).toBeInTheDocument();
  expect(within(rowOf('글자 크기')).getByText('System.json · advanced.fontSize')).toBeInTheDocument();
  expect(within(rowOf('자료실 버그')).getByText('충돌 · 원본 이벤트가 기록했을 때와 달라졌어요')).toBeInTheDocument();
  expect(within(rowOf('자료실 버그')).getByRole('button', { name: 'Claude에게 맡기기' })).toBeInTheDocument();
});

test('켜고 끄기와 원본 버그 표시', async () => {
  const user = await openPatches();
  await user.click(within(rowOf('이벤트2로 넘어가게 하기')).getByRole('switch', { name: '적용' }));
  expect(api.calls).toContainEqual(['patches.update', 'p1', { enabled: false }]);
  await user.click(within(rowOf('자료실 버그')).getByRole('checkbox', { name: '원본 버그' }));
  expect(api.calls).toContainEqual(['patches.update', 'p3', { originalBug: true }]);
});

test('제목을 고치면 update 로 저장된다', async () => {
  const user = await openPatches();
  const input = screen.getByDisplayValue('글자 크기');
  await user.clear(input);
  await user.type(input, '글씨 크기{Enter}');
  expect(api.calls).toContainEqual(['patches.update', 'p2', { title: '글씨 크기' }]);
});

test('제작자 전달용 목록', async () => {
  const user = await openPatches();
  await user.click(screen.getByRole('button', { name: '제작자 전달용 목록' }));
  const dlg = await screen.findByRole('dialog', { name: '제작자 전달용 목록' });
  expect(within(dlg).getByText(/## 1\. 이벤트2로 넘어가게 하기/)).toBeInTheDocument();
  expect(within(dlg).getByRole('button', { name: '복사' })).toBeInTheDocument();
});

test('삭제는 확인을 누른 뒤에만', async () => {
  const user = await openPatches();
  await user.click(within(rowOf('글자 크기')).getByRole('button', { name: '삭제' }));
  expect(api.calls.some((c) => c[0] === 'patches.remove')).toBe(false);
  await user.click(within(rowOf('글자 크기')).getByRole('button', { name: '정말 삭제' }));
  expect(api.calls).toContainEqual(['patches.remove', 'p2']);
});

test('이벤트 보기와 Claude에게 맡기기', async () => {
  const user = await openPatches();
  await user.click(within(rowOf('자료실 버그')).getByRole('button', { name: 'Claude에게 맡기기' }));
  expect(useApp.get().rightTab).toBe('chat');
  expect(useApp.get().attachedEvent).toMatchObject({ file: 'data/CommonEvents.json', listPath: [4, 'list'] });
  expect(screen.getByLabelText('메시지')).toHaveValue('이 수정이 충돌났어: 자료실 버그');
  await user.click(within(rowOf('이벤트2로 넘어가게 하기')).getByRole('button', { name: '이벤트 보기' }));
  expect(useApp.get().eventFocus).toMatchObject({ file: MAP, listPath: ['events', 12, 'pages', 1, 'list'] });
});

test('수정이 없으면 안내', async () => {
  eventsFake(api).patches = [];
  eventsFake(api).statuses = [];
  await openPatches();
  expect(screen.getByText('아직 수정이 없어요. 이벤트 화면에서 줄을 끼워 넣거나, 채팅에서 버그를 설명해 보세요.')).toBeInTheDocument();
});

async function openSettings() {
  const user = await openFakeWith(api);
  act(() => { useApp.setView('settings'); });
  await screen.findByRole('heading', { name: '설정' });
  return user;
}

test('폰트를 게임에 넣기: 스위치와 줄이기', async () => {
  eventsFake(api).patches = [];
  const pv = previewFake(api);
  pv.state = { ...pv.state, settings: { ...pv.state.settings, fontPath: 'C:/fonts/NanumGothic.ttf', fontName: '나눔고딕' } };
  const user = await openSettings();
  const section = await screen.findByRole('region', { name: '폰트를 게임에 넣기' });
  expect(within(section).getByText(/배포해도 되는 폰트인지 확인하세요/)).toBeInTheDocument();
  await user.click(within(section).getByRole('switch', { name: '이 폰트를 패치에 넣기' }));
  expect(api.calls).toContainEqual(['patches.setGameFont', 'C:/fonts/NanumGothic.ttf', true]);
  await user.click(within(section).getByRole('switch', { name: '이 폰트를 패치에 넣기' }));
  expect(api.calls).toContainEqual(['patches.setGameFont', null, true]);
  await user.click(within(section).getByRole('checkbox', { name: '쓰는 글자만 남겨 용량 줄이기' }));
  await user.click(within(section).getByRole('switch', { name: '이 폰트를 패치에 넣기' }));
  expect(api.calls).toContainEqual(['patches.setGameFont', 'C:/fonts/NanumGothic.ttf', false]);
});

test('폰트를 고르지 않았으면 스위치 없이 안내', async () => {
  await openSettings();
  const section = await screen.findByRole('region', { name: '폰트를 게임에 넣기' });
  expect(within(section).queryByRole('switch')).toBeNull();
  expect(within(section).getByText('위에서 게임 폰트를 먼저 고르세요')).toBeInTheDocument();
});

test('게임 실행 버튼과 상태', async () => {
  const user = await openFakeWith(api);
  await user.click(screen.getByRole('button', { name: '게임 실행' }));
  expect(api.calls).toContainEqual(['game.run']);
  api.emit('game:state', { state: 'preparing', done: 3, total: 10, firstRun: true });
  expect(screen.getByText('게임 준비 중 3 / 10')).toBeInTheDocument();
  expect(screen.getByText('시험용 사본을 만들어요. 처음 한 번은 시간이 걸려요.')).toBeInTheDocument();
  api.emit('game:state', { state: 'running' });
  expect(screen.getByText('게임 실행 중')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '끝내기' }));
  expect(api.calls).toContainEqual(['game.stop']);
  api.emit('game:state', { state: 'idle' });
  eventsFake(api).runError = '먼저 패치를 빌드하세요';
  await user.click(screen.getByRole('button', { name: '게임 실행' }));
  expect(await screen.findByText('먼저 패치를 빌드하세요')).toBeInTheDocument();
  void eventActions;
  await waitFor(() => expect(useApp.get().gameError).toBe('먼저 패치를 빌드하세요'));
});
