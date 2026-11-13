import { render, screen } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';
import { App } from '../../src/renderer/App';
import { useApp } from '../../src/renderer/state';
import { fakeApi, installApi, openFakeWith, row1, row2, scopes, settings, stats, type FakeApi } from './fakeApi';

let api: FakeApi;
let user: UserEvent;
const openFake = async () => { user = await openFakeWith(api); };

beforeEach(() => { api = fakeApi(); installApi(api); user = userEvent.setup(); });

test('프로젝트가 없으면 고르기 화면, 만들면 본 화면', async () => {
  render(<App />); expect(await screen.findByRole('heading', { name: '프로젝트' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: '게임 폴더 고르기' })); await user.clear(await screen.findByLabelText('프로젝트 이름')); await user.type(screen.getByLabelText('프로젝트 이름'), '약초원');
  await user.click(screen.getByRole('button', { name: '만들기' }));
  expect(await screen.findByText('霧の薬草園')).toBeVisible(); expect(api.calls).toContainEqual(['project.create', 'C:/game', '약초원']);
});
test('진행률과 범위', async () => {
  await openFake(); expect(screen.getByText('1 / 8줄 · 13%')).toBeVisible();
  await user.click(screen.getByRole('button', { name: /Items/ })); expect(useApp.get().query.file).toBe('data/Items.json');
});
test('테마 전환', async () => { await openFake(); api.emit('settings:changed', { ...settings, theme: 'light' }); expect(document.documentElement.dataset.theme).toBe('light'); });
test('변경 알림은 그 행만 바꾼다', async () => {
  await openFake(); const before = useApp.get().rowsById;
  api.emit('project:changed', { rows: [{ ...row1, target: '리나', status: 'needs-review' }], stats, scopes, origin: 'chat' });
  expect(useApp.get().rowsById[row1.id].target).toBe('리나'); expect(useApp.get().rowsById[row2.id]).toBe(before[row2.id]);
});
test('패치 빌드 결과', async () => {
  await openFake(); await user.click(screen.getByRole('button', { name: '패치 빌드' }));
  expect(await screen.findByText('패치를 만들었습니다 · 파일 3개 · 오류로 뺀 항목 1개')).toBeVisible();
});

// Extra coverage beyond the plan's assertions.
test('범위를 다시 누르면 해제, 설정 화면 이동, 상태 줄', async () => {
  await openFake();
  await user.click(screen.getByRole('button', { name: /Items/ }));
  await user.click(screen.getByRole('button', { name: /Items/ }));
  expect(useApp.get().query.file).toBeUndefined();
  expect(screen.getByText('Claude CLI 연결됨')).toBeVisible();
  expect(screen.getByRole('button', { name: /텍스트/ })).toHaveTextContent('7');
  await user.click(screen.getByRole('button', { name: '설정' }));
  expect(useApp.get().view).toBe('settings');
});
test('빌드 실패는 오류 글자', async () => {
  api.project.build = async () => { throw new Error('바뀐 파일이 없습니다'); };
  await openFake(); await user.click(screen.getByRole('button', { name: '패치 빌드' }));
  expect(await screen.findByText('바뀐 파일이 없습니다')).toBeVisible();
});
