import { EventEmitter } from 'node:events';
import { BrowserWindow, ipcMain, type IpcMainEvent, type WebContents } from 'electron';
import type { RenderReply, RenderRequest } from '../../shared/renderProtocol.js';
import type { RenderWindowLike } from './renderService.js';

/** Windows made by createRenderWindow (the app's quit logic ignores them). */
export const renderWindows = new WeakSet<BrowserWindow>();

/** The hidden worker window wrapped for RenderService: 'done' for each answer, 'closed' when it dies or closes. */
class ElectronRenderWindow extends EventEmitter implements RenderWindowLike {
  private readonly win: BrowserWindow;
  private readonly wc: WebContents;
  private readonly loaded: Promise<boolean>;
  private gone = false;
  private readonly onDone = (e: IpcMainEvent, reply: RenderReply) => {
    if (e.sender === this.wc) this.emit('done', reply);
  };

  constructor(o: { preload: string; url?: string; file: string }) {
    super();
    this.win = new BrowserWindow({
      show: false, width: 320, height: 240,
      webPreferences: { offscreen: false, contextIsolation: true, nodeIntegration: false, preload: o.preload, backgroundThrottling: false },
    });
    renderWindows.add(this.win);
    this.wc = this.win.webContents;
    this.loaded = new Promise((resolve) => {
      this.wc.once('did-finish-load', () => resolve(true));
      this.wc.once('did-fail-load', () => {
        resolve(false);
        this.lost();
      });
    });
    ipcMain.on('render:done', this.onDone);
    this.wc.on('render-process-gone', () => this.lost());
    this.win.on('closed', () => this.lost());
    if (o.url) void this.win.loadURL(o.url).catch(() => undefined);
    else void this.win.loadFile(o.file).catch(() => undefined);
  }

  private lost(): void {
    if (this.gone) return;
    this.gone = true;
    ipcMain.off('render:done', this.onDone);
    this.emit('closed');
  }

  send(req: RenderRequest): void {
    void this.loaded.then((ok) => {
      if (ok && !this.win.isDestroyed()) this.wc.send('render:job', req);
    });
  }

  destroy(): void {
    ipcMain.off('render:done', this.onDone);
    this.gone = true;
    if (!this.win.isDestroyed()) this.win.destroy();
  }
}

export function createRenderWindow(o: { preload: string; url?: string; file: string }): RenderWindowLike {
  return new ElectronRenderWindow(o);
}
