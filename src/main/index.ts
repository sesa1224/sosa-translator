import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { startBridge, writeMcpConfig, type Bridge } from './bridge.js';
import { ClaudeChat, findClaude } from './claude/chat.js';
import { registerIpc } from './ipc.js';
import { systemFontDirs } from './fonts/catalog.js';
import type { ProjectService } from './projectService.js';
import type { PushChannel, PushEvents } from '../shared/api.js';
import { RenderService } from './render/renderService.js';
import { createRenderWindow, renderWindows } from './render/renderWindow.js';

if (process.env.MVMZ_USER_DATA) app.setPath('userData', process.env.MVMZ_USER_DATA);

const here = path.dirname(fileURLToPath(import.meta.url));
const holder: { svc: ProjectService | null } = { svc: null };
let bridge: Bridge | null = null;
let mcpConfigPath = '';
let ipc: { dispose(): Promise<void> } | null = null;

/** The CLI to run: MVMZ_CLAUDE_COMMAND (tests) or the configured path, else claude on PATH. */
function resolveClaude(configured: string | null): string | null {
  return process.env.MVMZ_CLAUDE_COMMAND ?? findClaude(configured);
}

/** Test hook: MVMZ_CLAUDE_PREFIX_ARGS (JSON array) is put before the CLI arguments. */
function prefixArgs(): string[] {
  try {
    const v: unknown = JSON.parse(process.env.MVMZ_CLAUDE_PREFIX_ARGS ?? "[]");
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

/** CLI for one-shot JSON calls: MVMZ_CLAUDE_JSON_COMMAND (+ MVMZ_CLAUDE_JSON_PREFIX_ARGS) in tests, else the real CLI. */
function jsonClaude(configured: string | null): { command: string; prefixArgs: string[] } | null {
  if (process.env.MVMZ_CLAUDE_JSON_COMMAND) {
    let prefix: string[] = [];
    try {
      const v: unknown = JSON.parse(process.env.MVMZ_CLAUDE_JSON_PREFIX_ARGS ?? '[]');
      if (Array.isArray(v)) prefix = v.map(String);
    } catch {
      // ignore a broken test value
    }
    return { command: process.env.MVMZ_CLAUDE_JSON_COMMAND, prefixArgs: prefix };
  }
  const command = findClaude(configured);
  return command ? { command, prefixArgs: [] } : null;
}

function broadcast<C extends PushChannel>(channel: C, payload: PushEvents[C]): void {
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(channel, payload);
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'MV/MZ 번역 작업실',
    backgroundColor: '#121418',
    webPreferences: {
      preload: path.join(here, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else void win.loadFile(path.join(here, '../renderer/index.html'));
  return win;
}

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  bridge = await startBridge(() => holder.svc);
  mcpConfigPath = await writeMcpConfig(userData, bridge, path.join(here, 'mcp-server.js'), process.execPath);

  ipc = registerIpc({
    ipcMain,
    settingsDir: userData,
    documentsDir: app.getPath('documents'),
    holder,
    broadcast,
    pickDirectory: async () => {
      if (process.env.MVMZ_PICK_DIR) return process.env.MVMZ_PICK_DIR;
      const win = BrowserWindow.getFocusedWindow();
      const opts = { title: '게임 폴더 고르기', properties: ['openDirectory' as const] };
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0];
    },
    createChat: ({ cwd, systemPrompt, model, claudePath }) => {
      const command = resolveClaude(claudePath);
      if (!command) return null;
      return new ClaudeChat({ command, prefixArgs: prefixArgs(), cwd, mcpConfigPath, systemPrompt, model });
    },
    claudePath: resolveClaude,
    jsonClaude,
    showItemInFolder: (file) => shell.showItemInFolder(file),
    // MVMZ_FONT_DIRS (folders separated by ';') replaces the Windows font folders in tests.
    fontDirs: () => (process.env.MVMZ_FONT_DIRS ? process.env.MVMZ_FONT_DIRS.split(path.delimiter).filter(Boolean) : systemFontDirs()),
    pickFontFile: async () => {
      if (process.env.MVMZ_PICK_FONT) return process.env.MVMZ_PICK_FONT;
      const win = BrowserWindow.getFocusedWindow();
      const opts = { title: '폰트 파일 고르기', properties: ['openFile' as const], filters: [{ name: '폰트', extensions: ['ttf', 'otf'] }] };
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0];
    },
    pickSaveFile: async (defaultName) => {
      if (process.env.MVMZ_SAVE_FILE) return process.env.MVMZ_SAVE_FILE;
      const win = BrowserWindow.getFocusedWindow();
      const opts = { title: '외부 번역용으로 내보내기', defaultPath: defaultName, filters: [{ name: 'JSON', extensions: ['json'] }] };
      const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts);
      return r.canceled || !r.filePath ? null : r.filePath;
    },
    pickOpenFile: async () => {
      if (process.env.MVMZ_OPEN_FILE) return process.env.MVMZ_OPEN_FILE;
      const win = BrowserWindow.getFocusedWindow();
      const opts = { title: '외부 번역 가져오기', properties: ['openFile' as const], filters: [{ name: 'JSON', extensions: ['json'] }] };
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0];
    },
    // ---- plan 7 ----
    render: renderService,
    pickPngFile: async () => {
      if (process.env.MVMZ_PICK_PNG) return process.env.MVMZ_PICK_PNG;
      const win = BrowserWindow.getFocusedWindow();
      const opts = { title: '직접 고친 그림 고르기', properties: ['openFile' as const], filters: [{ name: 'PNG', extensions: ['png'] }] };
      const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0];
    },
  });

  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { app.quit(); });

// Finish pending saves and stop the bridge before quitting.
let quitting = false;
app.on('before-quit', (e) => {
  if (quitting) return;
  quitting = true;
  e.preventDefault();
  void Promise.allSettled([ipc?.dispose(), bridge?.close()]).finally(() => app.quit());
});

// ---- plan 7: hidden render worker window (made on first use) ----
const renderService = new RenderService({
  createWindow: () => createRenderWindow({
    preload: path.join(here, '../preload/render.cjs'),
    url: process.env.ELECTRON_RENDERER_URL ? `${process.env.ELECTRON_RENDERER_URL}/render-worker/index.html` : undefined,
    file: path.join(here, '../renderer/render-worker/index.html'),
  }),
});
// The hidden worker window would keep the app alive after the last real window closes.
app.on('browser-window-created', (_e, w) => {
  w.on('closed', () => {
    if (BrowserWindow.getAllWindows().every((x) => renderWindows.has(x))) renderService.dispose();
  });
});
app.on('will-quit', () => renderService.dispose());
// e2e tests reach the service through app.evaluate().
if (process.env.MVMZ_TEST_HOOKS === '1') (globalThis as { __mvmzTest?: unknown }).__mvmzTest = { render: renderService };
