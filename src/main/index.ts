import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { startBridge, writeMcpConfig, type Bridge } from './bridge.js';
import { ClaudeChat, findClaude } from './claude/chat.js';
import { registerIpc } from './ipc.js';
import type { ProjectService } from './projectService.js';
import type { PushChannel, PushEvents } from '../shared/api.js';

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
