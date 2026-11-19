// Updating the app itself from the GitHub Releases named in electron-builder.yml (publish). This is not the
// game update (core/update): that one brings in a new version of the game being translated.
//
// electron-updater does the work; this module keeps one simple state for the screens and turns its errors into
// Korean. The updater is passed in so tests can drive it with a fake emitter.
//
// The installer is not code-signed. electron-updater only checks the downloaded installer's signature when
// app-update.yml carries a publisherName (from win.publisherName or a signing certificate); neither is set,
// so NsisUpdater.verifySignature returns null and the update goes ahead. The sha512 in latest.yml is still checked.
import type { AppUpdateInfo, AppUpdateState } from '../shared/api.js';

/** The part of electron-updater's AppUpdater this module uses. */
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  checkForUpdates(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
  on(event: string, listener: (...a: any[]) => void): unknown;
}

const MAX_MESSAGE = 160;

/** A failure as the user can act on it: no connection, nothing published yet, or the short original message. */
export function updateErrorText(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ERR_CONNECTION/i.test(raw)) {
    return '인터넷에 연결할 수 없어요. 연결을 확인하고 다시 해 보세요.';
  }
  // A repository without a published (non-draft) release, or a release without latest.yml.
  if (/\b404\b|latest\.yml|No published versions|Unable to find latest version/i.test(raw)) {
    return 'GitHub 에 올라온 버전을 찾지 못했어요. 릴리스가 공개(Publish)됐는지 확인하세요.';
  }
  const first = raw.split('\n')[0].trim();
  const short = first.length > MAX_MESSAGE ? `${first.slice(0, MAX_MESSAGE)}…` : first;
  return `업데이트하지 못했어요: ${short}`;
}

export class AppUpdate {
  private current: AppUpdateState;
  /** The running check started quietly (on startup): its failures are not shown, only a found version is. */
  private quiet = false;
  /** The running check already reported its failure (electron-updater both emits 'error' and rejects). */
  private failed = false;

  constructor(private readonly o: {
    /** electron-updater's autoUpdater in an installed app; null when not packaged (dev, tests). */
    updater: UpdaterLike | null;
    version: string;
    onState(s: AppUpdateState): void;
  }) {
    const u = o.updater;
    this.current = u ? { kind: 'idle' } : { kind: 'unsupported' };
    if (!u) return;
    u.autoDownload = true;
    // Someone who closes the app without pressing "다시 시작해서 설치" still gets the new version next time.
    u.autoInstallOnAppQuit = true;
    u.on('checking-for-update', () => this.set({ kind: 'checking' }));
    u.on('update-available', (info: { version: string }) => this.set({ kind: 'available', version: String(info.version), percent: 0 }));
    u.on('download-progress', (p: { percent: number }) => {
      if (this.current.kind !== 'available') return;
      const percent = Math.max(0, Math.min(100, Math.round(Number(p.percent) || 0)));
      if (percent !== this.current.percent) this.set({ ...this.current, percent });
    });
    u.on('update-downloaded', (info: { version: string }) => this.set({ kind: 'downloaded', version: String(info.version) }));
    u.on('update-not-available', () => this.set({ kind: 'upToDate' }));
    u.on('error', (e: unknown) => this.fail(e));
  }

  info(): AppUpdateInfo {
    return { version: this.o.version, state: this.current };
  }

  /** Starts a check unless one is running or a version is already downloaded; answers the state after starting. */
  async check(opts: { quiet?: boolean } = {}): Promise<AppUpdateState> {
    const u = this.o.updater;
    if (!u) return this.current;
    if (this.current.kind === 'checking' || this.current.kind === 'available' || this.current.kind === 'downloaded') return this.current;
    this.quiet = opts.quiet === true;
    this.failed = false;
    // Not awaited: the check and download take a while and report through the events (pushed to the screens).
    void u.checkForUpdates().catch((e: unknown) => this.fail(e));
    return this.current;
  }

  /** Quits and installs the downloaded version; the installer starts the app again. */
  install(): void {
    if (this.current.kind !== 'downloaded') return;
    this.o.updater?.quitAndInstall();
  }

  private fail(e: unknown): void {
    if (this.failed) return;
    this.failed = true;
    console.warn('[appUpdate]', e instanceof Error ? e.message : e);
    this.set(this.quiet ? { kind: 'idle' } : { kind: 'error', message: updateErrorText(e) });
  }

  private set(s: AppUpdateState): void {
    this.current = s;
    this.o.onState(s);
  }
}

/** The appUpdate:* channels. Kept out of ipc.ts, which is about the open project; these work with none open. */
export function registerAppUpdate(
  ipcMain: { handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): void },
  au: Pick<AppUpdate, 'info' | 'check' | 'install'>,
): void {
  ipcMain.handle('appUpdate:get', () => au.info());
  ipcMain.handle('appUpdate:check', () => au.check());
  ipcMain.handle('appUpdate:install', () => { au.install(); });
}
