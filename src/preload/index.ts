import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { Api, InvokeChannel, PushChannel } from '../shared/api.js';
import type { PreviewInvokeChannel } from '../shared/api.js';

/** ipcRenderer.invoke with the "Error invoking remote method 'x': Error: " prefix removed. */
async function call(channel: InvokeChannel, ...args: unknown[]): Promise<any> {
  try {
    return await ipcRenderer.invoke(channel, ...args);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(msg.replace(/^Error invoking remote method '[^']+': (?:\w*Error: )?/, ''));
  }
}

/** call() for the plan 4 channels. */
function callP(channel: PreviewInvokeChannel, ...args: unknown[]): Promise<any> {
  return call(channel as unknown as InvokeChannel, ...args);
}

const api: Api = {
  settings: { get: () => call('settings:get'), set: (patch) => call('settings:set', patch) },
  project: {
    list: () => call('project:list'),
    pickGameDir: () => call('project:pickGameDir'),
    inspectGameDir: (dir) => call('project:inspectGameDir', dir),
    pathForDrop: (file) => webUtils.getPathForFile(file),
    create: (gameDir, name) => call('project:create', gameDir, name),
    open: (dir) => call('project:open', dir),
    close: () => call('project:close'),
    snapshot: () => call('project:snapshot'),
    undo: () => call('project:undo'),
    build: () => call('project:build'),
    setGameTitle: (target) => call('project:setGameTitle', target),
  },
  unit: {
    get: (id) => call('unit:get', id),
    setTranslation: (id, target) => call('unit:setTranslation', id, target),
    setStatus: (id, status) => call('unit:setStatus', id, status),
    clear: (id) => call('unit:clear', id),
    acceptReview: (id) => call('unit:acceptReview', id),
    rejectReview: (id) => call('unit:rejectReview', id),
  },
  glossary: {
    get: () => call('glossary:get'),
    upsertTerm: (t) => call('glossary:upsertTerm', t),
    removeTerm: (id) => call('glossary:removeTerm', id),
    choose: (id, target) => call('glossary:choose', id, target),
    setCharacters: (cards) => call('glossary:setCharacters', cards),
    setStyleGuide: (text) => call('glossary:setStyleGuide', text),
    setRules: (rules) => call('glossary:setRules', rules),
    confirm: () => call('glossary:confirm'),
    detectSpeakerPattern: () => call('glossary:detectSpeakerPattern'),
    defaultStyleGuide: () => call('glossary:defaultStyleGuide'),
  },
  job: {
    draft: (mode, choice) => call('job:draft', mode, choice),
    draftPlan: (mode, choice) => call('job:draftPlan', mode, choice),
    translate: (ids) => call('job:translate', ids),
    reviewPlan: (scope) => call('job:reviewPlan', scope),
    review: (scope) => call('job:review', scope),
    pause: () => call('job:pause'),
    resume: () => call('job:resume'),
    stop: () => call('job:stop'),
    current: () => call('job:current'),
    decide: () => call('job:decide'),
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
  decisions: {
    groups: () => call('decisions:groups'),
    set: (key, d) => call('decisions:set', key, d),
    confirm: (keys) => call('decisions:confirm', keys),
    clear: (key) => call('decisions:clear', key),
  },
  exchange: {
    export: (ids) => call('exchange:export', ids),
    planImport: () => call('exchange:planImport'),
    applyImport: (overwrite) => call('exchange:applyImport', overwrite),
  },
  on(channel: PushChannel, cb: (payload: any) => void) {
    const listener = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => { ipcRenderer.removeListener(channel, listener); };
  },
  preview: {
    get: () => callP('preview:get'),
    layout: (id, text) => callP('preview:layout', id, text),
    setFont: (path) => callP('preview:setFont', path),
    setOverrides: (o) => callP('preview:setOverrides', o),
    countOverflow: (path) => callP('preview:countOverflow', path),
    windowSkin: () => callP('preview:windowSkin'),
  },
  fonts: {
    list: () => callP('fonts:list'),
    bytes: (path) => callP('fonts:bytes', path),
    pickFile: () => callP('fonts:pickFile'),
  },
  story: {
    scenes: (file) => callP('story:scenes', file),
  },
};

contextBridge.exposeInMainWorld('api', api);
