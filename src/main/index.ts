import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';

if (process.env.MVMZ_USER_DATA) app.setPath('userData', process.env.MVMZ_USER_DATA);

const here = path.dirname(fileURLToPath(import.meta.url));

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

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { app.quit(); });
