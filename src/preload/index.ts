import { contextBridge, ipcRenderer } from 'electron';
import type { Api, InvokeChannel, PushChannel } from '../shared/api.js';

/** ipcRenderer.invoke with the "Error invoking remote method 'x': Error: " prefix removed. */
async function call(channel: InvokeChannel, ...args: unknown[]): Promise<any> {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(msg.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, ''));
  }
}

const api: Api = {
  settings: { get: () => call('settings:get'), set: (patch) => call('settings:set', patch) },
  project: {
    list: () => call('project:list'),
    pickGameDir: () => call('project:pickGameDir'),
    create: (gameDir, name) => call('project:create', gameDir, name),
    open: (dir) => call('project:open', dir),
    close: () => call('project:close'),
    snapshot: () => call('project:snapshot'),
    undo: () => call('project:undo'),
    build: () => call('project:build'),
  },
  unit: {
    get: (id) => call('unit:get', id),
    setTranslation: (id, target) => call('unit:setTranslation', id, target),
    setStatus: (id, status) => call('unit:setStatus', id, status),
    clear: (id) => call('unit:clear', id),
  },
  chat: {
    send: (text, images, attachedUnitId) => call('chat:send', text, images, attachedUnitId),
    stop: () => call('chat:stop'),
    reset: () => call('chat:reset'),
    setModel: (id) => call('chat:setModel', id),
    undo: () => call('chat:undo'),
  },
  app: {
    claudePath: () => call('app:claudePath'),
    showItemInFolder: (file) => call('app:showItemInFolder', file),
  },
  on(channel: PushChannel, cb: (payload: any) => void) {
    const listener = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => { ipcRenderer.removeListener(channel, listener); };
  },
};

contextBridge.exposeInMainWorld('api', api);
