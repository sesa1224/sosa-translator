import { EventEmitter } from 'node:events';
import { expect, test } from 'vitest';
import { AppUpdate, registerAppUpdate, updateErrorText, type UpdaterLike } from '../../src/main/appUpdate.js';
import type { AppUpdateState } from '../../src/shared/api.js';

/** Stands in for electron-updater's autoUpdater: tests fire its events by hand. */
class FakeUpdater extends EventEmitter implements UpdaterLike {
  autoDownload = false;
  autoInstallOnAppQuit = false;
  checks = 0;
  installs: unknown[][] = [];
  /** What the next checkForUpdates does: resolve, or reject with this error. */
  fail: Error | null = null;
  async checkForUpdates() {
    this.checks++;
    this.emit('checking-for-update');
    if (this.fail) {
      const e = this.fail;
      this.emit('error', e);
      throw e;
    }
    return null;
  }
  quitAndInstall(...a: unknown[]) { this.installs.push(a); }
}

function setup(o: { packaged?: boolean } = {}) {
  const updater = new FakeUpdater();
  const seen: AppUpdateState[] = [];
  const au = new AppUpdate({ updater: o.packaged === false ? null : updater, version: '1.12.0', onState: (s) => seen.push(s) });
  return { updater, au, seen };
}

test('설치한 앱이 아니면 확인할 수 없다고 알린다', async () => {
  const { au, updater, seen } = setup({ packaged: false });
  expect(au.info()).toEqual({ version: '1.12.0', state: { kind: 'unsupported' } });
  expect(await au.check()).toEqual({ kind: 'unsupported' });
  au.install();
  expect(updater.checks).toBe(0);
  expect(updater.installs).toEqual([]);
  expect(seen).toEqual([]);
});

test('받아서 내려받기를 켜고, 앱을 끌 때도 설치한다', () => {
  const { updater, au } = setup();
  expect(updater.autoDownload).toBe(true);
  expect(updater.autoInstallOnAppQuit).toBe(true);
  expect(au.info().state).toEqual({ kind: 'idle' });
});

test('새 버전: 확인 → 받는 중(퍼센트) → 받음 → 설치', async () => {
  const { updater, au, seen } = setup();
  expect(await au.check()).toEqual({ kind: 'checking' });
  updater.emit('update-available', { version: '1.13.0' });
  updater.emit('download-progress', { percent: 41.6 });
  expect(au.info().state).toEqual({ kind: 'available', version: '1.13.0', percent: 42 });
  // A second check while downloading does not start another one.
  expect(await au.check()).toEqual({ kind: 'available', version: '1.13.0', percent: 42 });
  expect(updater.checks).toBe(1);
  updater.emit('update-downloaded', { version: '1.13.0' });
  expect(seen).toEqual([
    { kind: 'checking' },
    { kind: 'available', version: '1.13.0', percent: 0 },
    { kind: 'available', version: '1.13.0', percent: 42 },
    { kind: 'downloaded', version: '1.13.0' },
  ]);
  expect(await au.check()).toEqual({ kind: 'downloaded', version: '1.13.0' });
  expect(updater.checks).toBe(1);
  au.install();
  expect(updater.installs).toHaveLength(1);
});

test('받기 전에는 설치하지 않는다', () => {
  const { updater, au } = setup();
  au.install();
  expect(updater.installs).toEqual([]);
});

test('최신 버전이면 그렇다고 알린다', async () => {
  const { updater, au } = setup();
  await au.check();
  updater.emit('update-not-available', { version: '1.12.0' });
  expect(au.info().state).toEqual({ kind: 'upToDate' });
  // It can be checked again later.
  await au.check();
  expect(updater.checks).toBe(2);
});

test('실패하면 한국어 이유를 한 번 알린다', async () => {
  const { updater, au, seen } = setup();
  updater.fail = new Error('net::ERR_INTERNET_DISCONNECTED');
  const s = await au.check();
  expect(s.kind).toBe('error');
  expect(au.info().state).toEqual({ kind: 'error', message: '인터넷에 연결할 수 없어요. 연결을 확인하고 다시 해 보세요.' });
  expect(seen.filter((x) => x.kind === 'error')).toHaveLength(1);
});

test('조용한 확인이 실패하면 알리지 않고 처음 상태로 둔다', async () => {
  const { updater, au, seen } = setup();
  updater.fail = new Error('getaddrinfo ENOTFOUND github.com');
  await au.check({ quiet: true });
  expect(au.info().state).toEqual({ kind: 'idle' });
  expect(seen.some((x) => x.kind === 'error')).toBe(false);
  // The quiet check found a version but the download broke: still nothing to say until the user asks.
  updater.fail = null;
  await au.check({ quiet: true });
  updater.emit('update-available', { version: '1.13.0' });
  updater.emit('error', new Error('socket hang up'));
  expect(au.info().state).toEqual({ kind: 'idle' });
  // A check the user asked for shows its failure.
  updater.fail = new Error('boom');
  await au.check();
  expect(au.info().state.kind).toBe('error');
});

test('실패 이유를 알아듣게 바꾼다', () => {
  expect(updateErrorText(new Error('getaddrinfo ENOTFOUND api.github.com'))).toMatch(/인터넷/);
  expect(updateErrorText(new Error('HttpError: 404 \n"method: GET url: https://github.com/sesa1224/sosa-translator/releases.atom'))).toMatch(/올라온 버전을 찾지 못했어요/);
  expect(updateErrorText(new Error('Cannot find latest.yml in the latest release artifacts'))).toMatch(/올라온 버전을 찾지 못했어요/);
  expect(updateErrorText(new Error('sha512 checksum mismatch'))).toMatch(/^업데이트하지 못했어요: sha512 checksum mismatch$/);
  expect(updateErrorText('x'.repeat(500)).length).toBeLessThan(200);
});

test('IPC: 상태 읽기, 확인, 설치', async () => {
  const { updater, au } = setup();
  const handlers = new Map<string, (...a: unknown[]) => unknown>();
  registerAppUpdate({ handle: (c, fn) => { handlers.set(c, fn); } }, au);
  expect([...handlers.keys()].sort()).toEqual(['appUpdate:check', 'appUpdate:get', 'appUpdate:install']);
  expect(await handlers.get('appUpdate:get')!({})).toEqual({ version: '1.12.0', state: { kind: 'idle' } });
  expect(await handlers.get('appUpdate:check')!({})).toEqual({ kind: 'checking' });
  updater.emit('update-downloaded', { version: '1.13.0' });
  await handlers.get('appUpdate:install')!({});
  expect(updater.installs).toHaveLength(1);
});
