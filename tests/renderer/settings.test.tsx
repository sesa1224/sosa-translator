import { act, cleanup, screen } from '@testing-library/react';
import { type UserEvent } from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { useApp } from '../../src/renderer/state';
import { DEFAULT_MODELS, type AppSettings } from '../../src/shared/api';
import { fakeApi, openFakeWith, type FakeApi } from './fakeApi';

const m1 = DEFAULT_MODELS[0];
let api: FakeApi;
let user: UserEvent;

async function openSettings(s: Partial<AppSettings> = {}) {
  cleanup();
  api = fakeApi({ settings: s });
  user = await openFakeWith(api);
  act(() => { useApp.setView('settings'); });
  await screen.findByRole('heading', { name: '설정' });
}

test('마지막 모델은 지울 수 없다', async () => { await openSettings({ models: [m1] }); expect(screen.getByRole('button', { name: 'Claude Fable 5.2 삭제' })).toBeDisabled(); });
test('모델 추가', async () => {
  await openSettings(); await user.type(screen.getByLabelText('모델 이름'), 'Claude Opus 6'); await user.type(screen.getByLabelText('모델 id'), 'claude-opus-6');
  await user.click(screen.getByRole('button', { name: '모델 추가' })); expect((api.calls.at(-1) as any)[1].models.at(-1)).toEqual({ id: 'claude-opus-6', label: 'Claude Opus 6' });
});

// Extra coverage beyond the plan's assertions.
test('테마, 기본 모델, 삭제, CLI 경로, 프로젝트 폴더', async () => {
  await openSettings();
  expect(screen.getByText('C:/claude.exe')).toBeVisible();
  await user.click(screen.getByRole('radio', { name: '밝은' }));
  expect(api.calls).toContainEqual(['settings.set', { theme: 'light' }]);
  expect(document.documentElement.dataset.theme).toBe('light');
  await user.selectOptions(screen.getByLabelText('채팅 기본 모델'), 'claude-opus-5-5');
  expect(api.calls).toContainEqual(['settings.set', { chatModel: 'claude-opus-5-5' }]);
  await user.click(screen.getByRole('button', { name: 'Claude Opus 5.5 삭제' }));
  expect(api.calls.at(-1)).toEqual(['settings.set', { models: DEFAULT_MODELS.filter((m) => m.id !== 'claude-opus-5-5'), chatModel: 'claude-fable-5-2' }]);
  await user.type(screen.getByLabelText('Claude CLI 경로'), 'D:/c.exe');
  await user.click(screen.getByRole('button', { name: 'CLI 경로 적용' }));
  expect(api.calls).toContainEqual(['settings.set', { claudePath: 'D:/c.exe' }]);
  await user.clear(screen.getByLabelText('프로젝트 폴더'));
  await user.type(screen.getByLabelText('프로젝트 폴더'), 'D:/p');
  await user.click(screen.getByRole('button', { name: '프로젝트 폴더 적용' }));
  expect(api.calls).toContainEqual(['settings.set', { projectsDir: 'D:/p' }]);
  await user.type(screen.getByLabelText('모델 id'), 'claude-fable-5-2');
  await user.type(screen.getByLabelText('모델 이름'), '중복');
  await user.click(screen.getByRole('button', { name: '모델 추가' }));
  expect(screen.getByText('이미 있는 모델 id 입니다')).toBeVisible();
});
