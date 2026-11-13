import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import { copyFile, link, mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const TESTPLAY_DIR = 'testplay';
const PATCHED_LIST = '.patched.json';
/** The project version the copy was made from (plan 6). */
export const VERSION_FILE = '.version';
/** Folders of big files the game only reads: shared with the original through hard links. */
const LINK_DIRS = new Set(['img', 'audio', 'movies', 'effects', 'locales', 'swiftshader']);
const LINK_EXTS = new Set(['.exe', '.dll', '.pak', '.bin', '.dat']);

async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  const go = async (abs: string, rel: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await go(path.join(abs, e.name), r);
      else if (e.isFile()) out.push(r);
    }
  };
  await go(root, '');
  return out.sort();
}

/** The path inside the content folder (an MV deployment keeps the game under www/). */
const inner = (rel: string): string => (rel.startsWith('www/') ? rel.slice(4) : rel);

function linkable(rel: string): boolean {
  const parts = rel.split('/');
  if (parts.length === 1) return LINK_EXTS.has(path.extname(rel).toLowerCase());
  return LINK_DIRS.has(inner(rel).split('/')[0].toLowerCase()) || LINK_DIRS.has(parts[0].toLowerCase());
}

const isSave = (rel: string): boolean => inner(rel).toLowerCase().startsWith('save/');

/**
 * A test-play copy of the game inside the project folder, with the latest patch on top, and the running game.
 * The original game folder is only read: big files are hard links (never written through), the rest are copies,
 * and a patched file replaces the copy's file after removing it, so a link to the original is cut first.
 */
export class GameRunner extends EventEmitter {
  private readonly dir: string;
  private readonly spawnFn: typeof nodeSpawn;
  private child: ChildProcess | null = null;

  /** version: the project version of gameDir; when the copy was made from another one it is made again. */
  constructor(private readonly o: { projectDir: string; gameDir: string; spawn?: typeof nodeSpawn; version?: string }) {
    super();
    this.dir = path.join(o.projectDir, TESTPLAY_DIR);
    this.spawnFn = o.spawn ?? nodeSpawn;
  }

  get running(): boolean {
    return this.child !== null;
  }

  /** Whether the copy has been made before (the first prepare takes longer). */
  get prepared(): boolean {
    return existsSync(path.join(this.dir, PATCHED_LIST));
  }

  /** Brings the copy up to date with the game and lays patchDir's files over it. */
  async prepare(patchDir: string, onProgress?: (done: number, total: number) => void): Promise<{ copied: number; linked: number; patched: number }> {
    if (this.o.version !== undefined) await this.startOverIfOtherVersion(this.o.version);
    const gameFiles = await walk(this.o.gameDir);
    const patchFiles = existsSync(patchDir) ? await walk(patchDir) : [];
    const inPatch = new Set(patchFiles);
    let previous: string[] = [];
    try {
      const raw = JSON.parse(await readFile(path.join(this.dir, PATCHED_LIST), 'utf8')) as unknown;
      if (Array.isArray(raw)) previous = raw.filter((x): x is string => typeof x === 'string');
    } catch {
      previous = [];
    }
    const wasPatched = new Set(previous);
    const total = gameFiles.length + patchFiles.length;
    let done = 0;
    let copied = 0;
    let linked = 0;
    await mkdir(this.dir, { recursive: true });

    const gameSet = new Set(gameFiles);
    for (const rel of gameFiles) {
      onProgress?.(done++, total);
      // The patch overwrites these below; copying the original first would be wasted work.
      if (inPatch.has(rel)) continue;
      const src = path.join(this.o.gameDir, ...rel.split('/'));
      const dst = path.join(this.dir, ...rel.split('/'));
      const restore = wasPatched.has(rel);
      if (isSave(rel) && existsSync(dst)) continue;
      if (!restore && existsSync(dst)) {
        const [a, b] = await Promise.all([stat(src), stat(dst)]);
        if (a.size === b.size && Math.abs(a.mtimeMs - b.mtimeMs) < 1) continue;
      }
      await mkdir(path.dirname(dst), { recursive: true });
      // Never write into an existing copy file: it may be a hard link to the original.
      await rm(dst, { force: true });
      if (linkable(rel)) {
        try {
          await link(src, dst);
          linked++;
          continue;
        } catch {
          // another drive or a file system without hard links: copy instead
        }
      }
      await copyFile(src, dst);
      const s = await stat(src);
      await utimes(dst, s.atime, s.mtime);
      copied++;
    }
    // Files an earlier patch added that the game does not have.
    for (const rel of previous) {
      if (!gameSet.has(rel) && !inPatch.has(rel)) await rm(path.join(this.dir, ...rel.split('/')), { force: true });
    }

    for (const rel of patchFiles) {
      onProgress?.(done++, total);
      const dst = path.join(this.dir, ...rel.split('/'));
      await mkdir(path.dirname(dst), { recursive: true });
      await rm(dst, { force: true });
      await copyFile(path.join(patchDir, ...rel.split('/')), dst);
    }
    await writeFile(path.join(this.dir, PATCHED_LIST), JSON.stringify(patchFiles));
    onProgress?.(total, total);
    return { copied, linked, patched: patchFiles.length };
  }

  /**
   * A copy made from another version of the game is made again: its saves move to testplay-saves-<old id>/ in the
   * project folder (they may not load in the new version) and the new copy starts with the new game's own saves.
   */
  private async startOverIfOtherVersion(version: string): Promise<void> {
    const marker = path.join(this.dir, VERSION_FILE);
    let was: string | null = null;
    try {
      was = (await readFile(marker, 'utf8')).trim() || null;
    } catch {
      was = null;   // a copy from before plan 6 is taken for the current version
    }
    if (was !== null && was !== version && existsSync(this.dir)) {
      const save = ['www/save', 'save'].map((r) => path.join(this.dir, ...r.split('/'))).find((d) => existsSync(d));
      if (save) {
        let dst = path.join(this.o.projectDir, `testplay-saves-${was}`);
        for (let n = 2; existsSync(dst); n++) dst = path.join(this.o.projectDir, `testplay-saves-${was}-${n}`);
        await rename(save, dst);
      }
      await rm(this.dir, { recursive: true, force: true });
    }
    await mkdir(this.dir, { recursive: true });
    await writeFile(marker, version);
  }

  /** Starts the copy's Game.exe (or nw.exe) in the copy's folder. */
  async launch(): Promise<void> {
    if (this.child) throw new Error('게임이 이미 실행 중입니다');
    const exe = ['Game.exe', 'nw.exe'].map((n) => path.join(this.dir, n)).find((f) => existsSync(f));
    if (!exe) throw new Error('실행 파일을 찾을 수 없습니다(Game.exe)');
    const child = this.spawnFn(exe, [], { cwd: this.dir, stdio: 'ignore' });
    this.child = child;
    const ended = () => {
      if (this.child !== child) return;
      this.child = null;
      this.emit('exit');
    };
    child.on('exit', ended);
    child.on('error', ended);
  }

  stop(): void {
    const child = this.child;
    if (!child) return;
    child.kill();
    if (this.child === child) {
      this.child = null;
      this.emit('exit');
    }
  }
}
