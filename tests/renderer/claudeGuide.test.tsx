// Claude CLI 안내, 상태 줄, 폰트에 없는 글자 수 (계획 6 작업 8)
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, test } from 'vitest';
import { fakeApi, openFakeWith, updateFake, type FakeApi } from './fakeApi';

let api: FakeApi;
beforeEach(() => {
  api = fakeApi();
});

test('CLI 가 없으면 안내 상자와 두 단계, 다시 확인이 상태를 다시 묻는다', async () => {
  updateFake(api).claude = { found: false, path: null, loggedIn: null };
  await openFakeWith(api, { rightTab: 'chat' });
  const box = within(await screen.findByRole('region', { name: 'Claude CLI 안내' }));
  expect(box.getByText('채팅과 자동 번역은 Claude CLI 가 있어야 해요. 본인의 Claude 구독으로 동작해요.')).toBeVisible();
  expect(box.getByText('winget install Anthropic.ClaudeCode')).toBeVisible();
  expect(box.getByText('claude')).toBeVisible();
  expect(box.getAllByRole('listitem')).toHaveLength(2);
  expect(box.getByText('추출, 손 번역, 빌드는 CLI 없이도 돼요.')).toBeVisible();
  const before = api.calls.filter((c) => c[0] === 'app.claudeStatus').length;
  updateFake(api).claude = { found: true, path: 'C:/claude.exe', loggedIn: true };
  await (await import('@testing-library/user-event')).default.setup().click(box.getByRole('button', { name: '다시 확인' }));
  expect(api.calls.filter((c) => c[0] === 'app.claudeStatus').length).toBeGreaterThan(before);
  await waitFor(() => expect(screen.queryByRole('region', { name: 'Claude CLI 안내' })).toBeNull());
});

test('로그인이 안 됐으면 로그인 단계만', async () => {
  updateFake(api).claude = { found: true, path: 'C:/claude.exe', loggedIn: false };
  await openFakeWith(api, { rightTab: 'chat' });
  const box = within(await screen.findByRole('region', { name: 'Claude CLI 안내' }));
  expect(box.getAllByRole('listitem')).toHaveLength(1);
  expect(box.queryByText('winget install Anthropic.ClaudeCode')).toBeNull();
  expect(box.getByText('claude')).toBeVisible();
});

test('다 되면 안내 상자가 없다', async () => {
  await openFakeWith(api, { rightTab: 'chat' });
  await waitFor(() => expect(api.calls.some((c) => c[0] === 'app.claudeStatus')).toBe(true));
  expect(screen.queryByRole('region', { name: 'Claude CLI 안내' })).toBeNull();
});

test('상태 줄: CLI 없음', async () => {
  updateFake(api).claude = { found: false, path: null, loggedIn: null };
  await openFakeWith(api);
  expect(await screen.findByText('Claude CLI 없음')).toBeVisible();
});

test('상태 줄: 로그인 필요', async () => {
  updateFake(api).claude = { found: true, path: 'C:/claude.exe', loggedIn: false };
  await openFakeWith(api);
  expect(await screen.findByText('로그인 필요')).toBeVisible();
});

test('상태 줄: 연결됨', async () => {
  await openFakeWith(api);
  await waitFor(() => expect(api.calls.some((c) => c[0] === 'app.claudeStatus')).toBe(true));
  expect(await screen.findByText('Claude CLI 연결됨')).toBeVisible();
});

test('설정에 지난 빌드의 폰트 크기와 없는 글자 수', async () => {
  updateFake(api).fontEmbed = { bytes: 2_048_000, missing: 3 };
  const user = await openFakeWith(api);
  await user.click(within(screen.getByRole('navigation', { name: '작업 메뉴' })).getByRole('button', { name: '설정' }));
  const missing = await screen.findByText('이 폰트에 없는 글자 3개');
  expect(missing).toBeVisible();
  expect(missing.className).toContain('warn-text');
  expect(screen.getByText(/지난 빌드: 폰트 2,000 KB/)).toBeVisible();
});
