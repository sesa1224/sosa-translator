// The main window has no system frame (frame: false), so its title bar draws its own minimize, maximize and
// close buttons. These handlers act on the window that sent the request, not on "the" main window, so a
// second window (or the hidden render worker) can never be closed by mistake.
import type { InvokeChannel, PushEvents } from '../shared/api.js';

/** The part of BrowserWindow the buttons use (a fake in tests). */
export interface FrameWindow {
  minimize(): void;
  isMaximized(): boolean;
  maximize(): void;
  unmaximize(): void;
  close(): void;
  on(event: 'maximize' | 'unmaximize', listener: () => void): unknown;
  webContents: { send(channel: 'window:maximized', payload: PushEvents['window:maximized']): void };
}

type Handler = (event: { sender: unknown }, ...args: unknown[]) => unknown;

export function registerWindowControls(
  ipcMain: { handle(channel: InvokeChannel, listener: Handler): void },
  windowOf: (sender: unknown) => FrameWindow | null,
): void {
  const on = (channel: InvokeChannel, fn: (w: FrameWindow) => unknown, otherwise: unknown = undefined) => {
    ipcMain.handle(channel, (e) => {
      const w = windowOf(e.sender);
      return w ? fn(w) : otherwise;
    });
  };
  on('window:minimize', (w) => { w.minimize(); });
  on('window:toggleMaximize', (w) => { if (w.isMaximized()) w.unmaximize(); else w.maximize(); });
  // close() is what the system close button does: the 'close' event, then window-all-closed and the
  // before-quit cleanup in index.ts, so pending saves still finish.
  on('window:close', (w) => { w.close(); });
  on('window:isMaximized', (w) => w.isMaximized(), false);
}

/** Tells the window's page when it is maximized or restored (also by double-clicking the title bar or Win+arrow). */
export function reportMaximize(win: FrameWindow): void {
  win.on('maximize', () => win.webContents.send('window:maximized', true));
  win.on('unmaximize', () => win.webContents.send('window:maximized', false));
}
