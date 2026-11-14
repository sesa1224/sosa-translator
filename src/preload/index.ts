import { contextBridge, ipcRenderer, webUtils } from 'electron';
import type { Api, InvokeChannel, PushChannel } from '../shared/api.js';

// Builds window.api from the channel list in src/shared/api.ts. Each method is a thin ipcRenderer.invoke;
// the renderer has no Node access and reaches files only through these channels.

/** ipcRenderer.invoke with the "Error invoking remote method 'x': Error: " prefix removed, so screens can show the Korean message as is. */
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
    inspectGameDir: (dir) => call('project:inspectGameDir', dir),
    unpackGame: (exe) => call('project:unpackGame', exe),
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
    promptText: (kind) => call('glossary:promptText', kind),
    setPromptText: (kind, text) => call('glossary:setPromptText', kind, text),
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
    claudeStatus: () => call('app:claudeStatus'),
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
    get: () => call('preview:get'),
    layout: (id, text) => call('preview:layout', id, text),
    setFont: (path) => call('preview:setFont', path),
    setOverrides: (o) => call('preview:setOverrides', o),
    countOverflow: (path) => call('preview:countOverflow', path),
    windowSkin: () => call('preview:windowSkin'),
  },
  fonts: {
    list: () => call('fonts:list'),
    bytes: (path) => call('fonts:bytes', path),
    pickFile: () => call('fonts:pickFile'),
  },
  story: {
    scenes: (file) => call('story:scenes', file),
  },
  events: {
    files: () => call('events:files'),
    list: (file) => call('events:list', file),
    read: (file, listPath, version) => call('events:read', file, listPath, version),
    usage: (target) => call('events:usage', target),
  },
  patches: {
    list: () => call('patches:list'),
    add: (p) => call('patches:add', p),
    update: (id, p) => call('patches:update', id, p),
    remove: (id) => call('patches:remove', id),
    setGameFont: (fontPath, subset) => call('patches:setGameFont', fontPath, subset),
    creatorReport: () => call('patches:creatorReport'),
    lastFontEmbed: () => call('patches:lastFontEmbed'),
  },
  game: {
    run: () => call('game:run'),
    stop: () => call('game:stop'),
  },
  images: {
    list: () => call('images:list'),
    recipe: (file) => call('images:recipe', file),
    thumb: (file, which) => call('images:thumb', file, which),
    full: (file, which) => call('images:full', file, which),
    setRecipe: (file, regions) => call('images:setRecipe', file, regions),
    setStatus: (file, status) => call('images:setStatus', file, status),
    pickManual: (file) => call('images:pickManual', file),
    clearManual: (file) => call('images:clearManual', file),
    acceptBase: (file) => call('images:acceptBase', file),
    setDefaultFont: (path) => call('images:setDefaultFont', path),
    rerenderAll: () => call('images:rerenderAll'),
    defaultFont: () => call('images:defaultFont'),
    overflow: (file) => call('images:overflow', file),
    failure: (file) => call('images:failure', file),
    folders: () => call('images:folders'),
    setFolders: (folders) => call('images:setFolders', folders),
  },
  builds: {
    list: () => call('builds:list'),
    setNotes: (number, text) => call('builds:setNotes', number, text),
    polishNotes: (number) => call('builds:polishNotes', number),
    openFolder: (number) => call('builds:openFolder', number),
  },
  update: {
    inspect: (gameDir) => call('update:inspect', gameDir),
    pickGameDir: () => call('update:pickGameDir'),
    import: (gameDir, label) => call('update:import', gameDir, label),
    rollback: () => call('update:rollback'),
    summary: () => call('update:summary'),
    versions: () => call('update:versions'),
  },
};

contextBridge.exposeInMainWorld('api', api);
