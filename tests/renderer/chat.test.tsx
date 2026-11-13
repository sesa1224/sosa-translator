import { cleanup, fireEvent, screen } from '@testing-library/react';
import { type UserEvent } from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';
import { useApp } from '../../src/renderer/state';
import { fakeApi, itemId, openFakeWith, type FakeApi } from './fakeApi';

let api: FakeApi;
let user: UserEvent;
const zero = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };

async function openFake(o: { rightTab?: 'item' | 'chat' } = {}) {
  cleanup();
  api = fakeApi();
  user = await openFakeWith(api, { rightTab: o.rightTab ?? 'chat' });
}

function fileOf(name: string, type: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type });
}

/** Minimal clipboard/drag data carrying one file (jsdom has no DataTransfer). */
function transferOf(file: File) {
  return {
    files: [file] as unknown as FileList,
    items: [{ kind: 'file', type: file.type, getAsFile: () => file }],
    types: ['Files'],
    getData: () => '',
    setData: () => undefined,
    clearData: () => undefined,
    dropEffect: 'copy', effectAllowed: 'all',
  } as unknown as DataTransfer;
}

const pngClipboard = (size: number) => transferOf(fileOf('shot.png', 'image/png', size));

async function dropFile(name: string, type: string) {
  fireEvent.drop(screen.getByLabelText('메시지'), { dataTransfer: transferOf(fileOf(name, type, 100)) });
}

beforeEach(async () => { await openFake(); });

test('보내고 답이 이어서 그려진다', async () => {
  await openFake({ rightTab: 'chat' }); await user.type(screen.getByLabelText('메시지'), '안녕{Enter}');
  expect(api.calls).toContainEqual(['chat.send', '안녕', [], undefined]);
  api.emit('chat:event', { type: 'text-delta', text: '찾아' }); api.emit('chat:event', { type: 'text-delta', text: '볼게' });
  expect(await screen.findByText('찾아볼게')).toBeVisible(); expect(screen.getByRole('button', { name: '멈추기' })).toBeVisible();
  api.emit('chat:event', { type: 'turn-end', ok: true, usage: { input: 1200, output: 300, cacheRead: 0, cacheCreate: 0 } });
  expect(screen.getByRole('button', { name: '보내기' })).toBeVisible(); expect(screen.getByText('이번 대화 1,500 토큰')).toBeVisible();
});
test('도구 줄과 이동', async () => {
  api.emit('chat:event', { type: 'tool-start', id: 't1', name: 'search_units', input: { query: '記録' } });
  api.emit('chat:event', { type: 'tool-start', id: 't2', name: 'set_translation', input: { id: itemId, target: '월광초' } });
  expect(await screen.findByText('검색 · "記録"')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '수정 · Items · 1' })); expect(useApp.get().selectedId).toBe(itemId);
});
test('이미지 붙여넣기', async () => {
  await user.click(screen.getByLabelText('메시지')); await user.paste(pngClipboard(1000)); expect(await screen.findByAltText('첨부 1')).toBeVisible();
  await user.type(screen.getByLabelText('메시지'), '여기{Enter}'); expect(api.calls.at(-1)).toEqual(['chat.send', '여기', [{ mediaType: 'image/png', base64: expect.any(String) }], undefined]);
});
test('너무 큰 이미지와 지원하지 않는 형식', async () => {
  await user.paste(pngClipboard(6 * 1024 * 1024)); expect(await screen.findByText('이미지가 너무 큽니다(최대 5MB)')).toBeVisible();
  await dropFile('a.gif', 'image/gif'); expect(await screen.findByText('PNG, JPEG, WebP 이미지만 보낼 수 있어요')).toBeVisible(); expect(screen.queryByAltText('첨부 1')).toBeNull();
});
test('오류는 한 줄로', async () => {
  api.emit('chat:event', { type: 'turn-end', ok: false, usage: zero, error: '로그인이 필요합니다. 터미널에서 claude 를 실행해 로그인하세요.' });
  expect(await screen.findByText(/로그인이 필요합니다/)).toBeVisible(); expect(screen.getByRole('button', { name: '보내기' })).toBeEnabled();
});

// Extra coverage beyond the plan's assertions.
test('붙은 항목과 함께 보내기, 떼기, Shift+Enter, 새 대화, 되돌리기, 모델', async () => {
  act0(() => useApp.talkAbout(itemId));
  expect(await screen.findByText(/붙은 항목 · Items · 1/)).toBeVisible();
  await user.type(screen.getByLabelText('메시지'), '한 줄{Shift>}{Enter}{/Shift}두 줄{Enter}');
  expect(api.calls.at(-1)).toEqual(['chat.send', '한 줄\n두 줄', [], itemId]);
  act0(() => useApp.talkAbout(itemId));
  await user.click(await screen.findByRole('button', { name: '붙은 항목 떼기' }));
  expect(useApp.get().attachedId).toBeNull();
  api.emit('chat:event', { type: 'turn-end', ok: true, usage: zero });
  await user.click(screen.getByRole('button', { name: '방금 변경 되돌리기' }));
  expect(api.calls).toContainEqual(['chat.undo']);
  await user.selectOptions(screen.getByLabelText('채팅 모델'), 'claude-haiku-5-5');
  expect(api.calls).toContainEqual(['chat.setModel', 'claude-haiku-5-5']);
  await user.click(screen.getByRole('button', { name: '새 대화' }));
  expect(api.calls).toContainEqual(['chat.reset']);
  expect(screen.queryByText('한 줄')).toBeNull();
});
test('멈추기와 4장 제한, 실패한 도구 줄', async () => {
  await user.type(screen.getByLabelText('메시지'), '느리게{Enter}');
  await user.click(screen.getByRole('button', { name: '멈추기' }));
  expect(api.calls).toContainEqual(['chat.stop']);
  api.emit('chat:event', { type: 'tool-start', id: 't9', name: 'get_unit', input: { id: 'nope' } });
  api.emit('chat:event', { type: 'tool-end', id: 't9', isError: true, summary: '{"error":"없는 항목입니다: nope"}' });
  expect(screen.getByText('읽음 · nope')).toHaveClass('err-text');
  api.emit('chat:event', { type: 'turn-end', ok: true, usage: zero });
  for (let i = 0; i < 5; i++) await user.paste(pngClipboard(10));
  expect(await screen.findByText('이미지는 한 번에 4장까지 보낼 수 있어요')).toBeVisible();
  expect(screen.getAllByAltText(/첨부 \d/)).toHaveLength(4);
});

import { act } from '@testing-library/react';
function act0(fn: () => void) { act(fn); }
