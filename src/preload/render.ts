// Preload of the hidden render worker window: only the two messages it needs.
import { contextBridge, ipcRenderer } from 'electron';
import type { RenderBridge } from '../shared/renderProtocol.js';

const bridge: RenderBridge = {
  onJob: (cb) => { ipcRenderer.on('render:job', (_e, req) => cb(req)); },
  done: (reply) => { ipcRenderer.send('render:done', reply); },
};

contextBridge.exposeInMainWorld('renderBridge', bridge);
