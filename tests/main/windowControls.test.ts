import { EventEmitter } from 'node:events';
import { expect, test } from 'vitest';
import { registerWindowControls, reportMaximize, type FrameWindow } from '../../src/main/windowControls.js';

class FakeWindow extends EventEmitter implements FrameWindow {
  maximized = false; minimized = false; closed = false; sent: [string, unknown][] = [];
  webContents = { send: (channel: string, payload: unknown) => { this.sent.push([channel, payload]); } };
  minimize() { this.minimized = true; }
  isMaximized() { return this.maximized; }
  maximize() { this.maximized = true; this.emit('maximize'); }
  unmaximize() { this.maximized = false; this.emit('unmaximize'); }
  close() { this.closed = true; }
}

function setup() {
  const handlers = new Map<string, (e: { sender: unknown }, ...a: unknown[]) => unknown>();
  const win = new FakeWindow();
  const sender = {};
  registerWindowControls({ handle: (c, fn) => { handlers.set(c, fn); } }, (s) => (s === sender ? win : null));
  const invoke = (c: string) => handlers.get(c)!({ sender });
  return { handlers, win, invoke };
}

test('창 단추: 최소화, 최대화와 되돌리기, 닫기는 보낸 창에만', async () => {
  const { handlers, win, invoke } = setup();
  expect([...handlers.keys()].sort()).toEqual(['window:close', 'window:isMaximized', 'window:minimize', 'window:toggleMaximize']);
  await invoke('window:minimize'); expect(win.minimized).toBe(true);
  expect(await invoke('window:isMaximized')).toBe(false);
  await invoke('window:toggleMaximize'); expect(win.maximized).toBe(true);
  expect(await invoke('window:isMaximized')).toBe(true);
  await invoke('window:toggleMaximize'); expect(win.maximized).toBe(false);
  await invoke('window:close'); expect(win.closed).toBe(true);
  // A sender that is no app window (e.g. already closed) is ignored.
  expect(await handlers.get('window:isMaximized')!({ sender: {} })).toBe(false);
  await handlers.get('window:close')!({ sender: {} });
});

test('최대화가 바뀌면 그 창에 알린다', () => {
  const win = new FakeWindow();
  reportMaximize(win);
  win.maximize(); win.unmaximize();
  expect(win.sent).toEqual([['window:maximized', true], ['window:maximized', false]]);
});
