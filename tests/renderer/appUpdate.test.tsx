import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { App } from '../../src/renderer/App';
import { useApp } from '../../src/renderer/state';
import type { AppUpdateState } from '../../src/shared/api';
import { fakeApi, installApi, openFakeWith, type FakeApi } from './fakeApi';

let api: FakeApi;
let user: UserEvent;

async function openSettings(state: AppUpdateState = { kind: 'idle' }) {
  cleanup();
  api = fakeApi();
  api.appUpdateInfo = { version: '1.12.0', state };
  user = await openFakeWith(api);
  act(() => { useApp.setView('settings'); });
  await screen.findByRole('heading', { name: '설정' });
  return within(screen.getByRole('region', { name: '앱 업데이트' }));
}

const toasts = () => within(screen.getByRole('region', { name: '알림' }));

test('설정: 앱 버전과 업데이트 확인, 받는 중, 받으면 다시 시작해서 설치', async () => {
  const row = await openSettings();
  expect(row.getByText('앱 버전 1.12.0')).toBeVisible();
  const check = row.getByRole('button', { name: '업데이트 확인' });
  expect(check).not.toHaveClass('primary');
  await user.click(check);
  expect(api.calls).toContainEqual(['appUpdate.check']);
  expect(row.getByText('확인하는 중…')).toBeVisible();
  expect(row.getByRole('button', { name: '업데이트 확인' })).toBeDisabled();
  api.emit('appUpdate:state', { kind: 'available', version: '1.13.0', percent: 42 });
  expect(row.getByText('새 버전 1.13.0 받는 중 42%')).toBeVisible();
  expect(row.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '42');
  expect(row.queryByRole('button', { name: '다시 시작해서 설치' })).toBeNull();
  api.emit('appUpdate:state', { kind: 'downloaded', version: '1.13.0' });
  expect(row.getByText('새 버전 1.13.0 을 받았어요')).toBeVisible();
  // Once downloaded, installing is the thing to do here: it becomes the row's main button.
  const install = row.getByRole('button', { name: '다시 시작해서 설치' });
  expect(install).toHaveClass('primary');
  expect(row.queryByRole('button', { name: '업데이트 확인' })).toBeNull();
  await user.click(install);
  expect(api.calls).toContainEqual(['appUpdate.install']);
});

test('설정: 최신 버전, 실패 이유, 설치한 앱이 아닐 때', async () => {
  let row = await openSettings({ kind: 'upToDate' });
  expect(row.getByText('최신 버전이에요')).toBeVisible();
  api.emit('appUpdate:state', { kind: 'error', message: '인터넷에 연결할 수 없어요. 연결을 확인하고 다시 해 보세요.' });
  expect(row.getByText('인터넷에 연결할 수 없어요. 연결을 확인하고 다시 해 보세요.')).toBeVisible();
  expect(row.getByRole('button', { name: '업데이트 확인' })).toBeEnabled();

  row = await openSettings({ kind: 'unsupported' });
  expect(row.getByText('설치한 앱에서만 확인할 수 있어요')).toBeVisible();
  expect(row.getByRole('button', { name: '업데이트 확인' })).toBeDisabled();
});

test('새 버전을 받으면 알림이 뜨고, 알림의 단추로 다시 시작한다. 실패는 알리지 않는다', async () => {
  cleanup();
  api = fakeApi();
  user = await openFakeWith(api);
  api.emit('appUpdate:state', { kind: 'checking' });
  api.emit('appUpdate:state', { kind: 'error', message: '업데이트하지 못했어요: x' });
  expect(toasts().queryByText(/업데이트/)).toBeNull();
  api.emit('appUpdate:state', { kind: 'available', version: '1.13.0', percent: 10 });
  expect(toasts().queryByText(/1\.13\.0/)).toBeNull();
  api.emit('appUpdate:state', { kind: 'downloaded', version: '1.13.0' });
  expect(toasts().getByText('새 버전 1.13.0 을 받았어요 — 다시 시작하면 설치돼요')).toBeVisible();
  // The same state pushed again does not add a second note.
  api.emit('appUpdate:state', { kind: 'downloaded', version: '1.13.0' });
  expect(toasts().getAllByText(/새 버전 1\.13\.0/)).toHaveLength(1);
  await user.click(toasts().getByRole('button', { name: '다시 시작' }));
  expect(api.calls).toContainEqual(['appUpdate.install']);
});

test('프로젝트가 없을 때도 첫 화면에서 앱 버전을 보고 확인한다', async () => {
  cleanup();
  api = fakeApi();
  installApi(api);
  user = userEvent.setup();
  render(<App />);
  await screen.findByRole('heading', { name: '프로젝트' });
  const row = within(screen.getByRole('region', { name: '앱 업데이트' }));
  expect(row.getByText('앱 버전 1.12.0')).toBeVisible();
  await user.click(row.getByRole('button', { name: '업데이트 확인' }));
  expect(api.calls).toContainEqual(['appUpdate.check']);
  api.emit('appUpdate:state', { kind: 'downloaded', version: '1.13.0' });
  expect(toasts().getByText('새 버전 1.13.0 을 받았어요 — 다시 시작하면 설치돼요')).toBeVisible();
});

test('명령 검색의 "앱 업데이트 확인"은 설정으로 가서 확인한다', async () => {
  await openSettings();
  act(() => { useApp.setView('text'); });
  await user.keyboard('{Control>}k{/Control}');
  const palette = within(screen.getByRole('dialog', { name: '명령 검색' }));
  await user.click(palette.getByRole('option', { name: /앱 업데이트 확인/ }));
  expect(api.calls).toContainEqual(['appUpdate.check']);
  expect(useApp.get().view).toBe('settings');
});
