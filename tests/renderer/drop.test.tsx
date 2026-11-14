// 게임 폴더 끌어다 놓기
import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { App } from '../../src/renderer/App';
import { fakeApi, installApi, openFakeWith } from './fakeApi';

function dropFiles(target: Element, files: { name: string; path: string }[]) {
  const list = files.map((f) => Object.assign(new File([''], f.name), { path: f.path }));
  const dataTransfer = { files: list, types: ['Files'] };
  fireEvent.dragEnter(target, { dataTransfer });
  fireEvent.dragOver(target, { dataTransfer });
  fireEvent.drop(target, { dataTransfer });
}

async function openPicker(inspect?: Parameters<typeof fakeApi>[0]) {
  const api = fakeApi(inspect);
  installApi(api);
  const user = userEvent.setup();
  render(<App />);
  await screen.findByRole('heading', { name: '프로젝트' });
  return { api, user };
}

test('폴더를 놓으면 확인을 거쳐 이름 칸이 제목으로 채워진다', async () => {
  const { api, user } = await openPicker();
  const page = screen.getByTestId('picker');
  fireEvent.dragOver(page, { dataTransfer: { files: [], types: ['Files'] } });
  expect(screen.getByText('여기에 게임 폴더를 놓으세요')).toBeVisible();
  dropFiles(page, [{ name: 'game', path: 'C:/games/약초원' }, { name: 'other', path: 'C:/games/other' }]);
  expect(await screen.findByText('MZ · 霧の薬草園')).toBeVisible();
  expect(api.calls).toContainEqual(['project.inspectGameDir', 'C:/games/약초원']);
  expect(api.calls.filter((c) => c[0] === 'project.inspectGameDir')).toHaveLength(1);
  expect((screen.getByLabelText('프로젝트 이름') as HTMLInputElement).value).toBe('霧の薬草園');
  await user.click(screen.getByRole('button', { name: '만들기' }));
  expect(api.calls).toContainEqual(['project.create', 'C:/games/약초원', '霧の薬草園']);
});

test('MV/MZ 가 아니면 오류가 보이고 만들기 버튼이 없다', async () => {
  const { api } = await openPicker();
  api.inspect = () => ({ ok: false, error: 'RPG Maker MV/MZ 게임 폴더가 아닙니다: js/rmmz_core.js 와 js/rpg_core.js 가 모두 없습니다' });
  dropFiles(screen.getByTestId('picker'), [{ name: 'x', path: 'C:/x' }]);
  expect(await screen.findByText(/게임 폴더가 아닙니다/)).toBeVisible();
  expect(screen.queryByRole('button', { name: '만들기' })).toBeNull();
  expect(screen.queryByLabelText('프로젝트 이름')).toBeNull();
});

test('게임 폴더 고르기도 같은 확인과 미리 채우기를 한다', async () => {
  const { api, user } = await openPicker();
  await user.click(screen.getByRole('button', { name: '게임 폴더 고르기' }));
  expect(api.calls).toContainEqual(['project.inspectGameDir', 'C:/game']);
  expect((await screen.findByLabelText('프로젝트 이름') as HTMLInputElement).value).toBe('霧の薬草園');
});

test('프로젝트가 열려 있으면 놓아도 확인하지 않는다', async () => {
  const api = fakeApi();
  await openFakeWith(api);
  await act(async () => { dropFiles(document.body, [{ name: 'game', path: 'C:/games/약초원' }]); });
  expect(api.calls.some((c) => c[0] === 'project.inspectGameDir')).toBe(false);
  expect(screen.getByText('霧の薬草園')).toBeVisible();
});

test('뭉친 exe 게임이면 풀기 버튼이 보이고, 풀면 이름 칸으로 이어진다', async () => {
  const { api, user } = await openPicker();
  api.inspect = (dir) => (dir.includes('_풀린 게임')
    ? { ok: true, dir, engine: 'MV', title: '封印の騎士', suggestedName: '封印の騎士' }
    : { ok: false, error: 'exe 하나로 뭉쳐진 게임입니다. 먼저 풀어야 합니다', packed: { exe: 'C:/games/knight/Game.exe', files: 1234, bytes: 3 * 1024 ** 3 } });
  dropFiles(screen.getByTestId('picker'), [{ name: 'knight', path: 'C:/games/knight' }]);
  const box = await screen.findByTestId('packed-game');
  expect(box).toHaveTextContent('Game.exe · 파일 1,234개 · 3.0GB');
  expect(screen.queryByRole('button', { name: '만들기' })).toBeNull();
  await user.click(screen.getByRole('button', { name: '풀고 계속' }));
  expect(await screen.findByText('MV · 封印の騎士')).toBeVisible();
  expect(api.calls).toContainEqual(['project.unpackGame', 'C:/games/knight/Game.exe']);
  expect(screen.queryByTestId('packed-game')).toBeNull();
  await user.click(screen.getByRole('button', { name: '만들기' }));
  expect(api.calls).toContainEqual(['project.create', 'C:/projects/_풀린 게임/knight', '封印の騎士']);
});
