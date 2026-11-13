import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { decryptAsset } from '../engine/crypto.js';
import { openProject, originalDir } from '../project/project.js';
import type { GameInfo } from '../types.js';
import { readJsonFile, writeJsonFile } from '../util/json.js';
import type { ImageEntry } from './types.js';

/** Folders that usually hold pictures with words in them (menus, titles, system graphics). */
export const IMAGE_FOLDERS = ['img/pictures', 'img/titles1', 'img/titles2', 'img/system', 'img/parallaxes'];

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const ENCRYPTED = ['.png_', '.rpgmvp'];
const CATALOG_VERSION = 1;
/** Files read at the same time while listing: enough to keep the disk busy, few enough not to hold thousands of pictures in memory. */
const READ_AT_ONCE = 8;

export interface ScannedImage { file: string; sourceFile: string; encrypted: boolean; bytes: number; mtimeMs: number }

function isPng(b: Uint8Array): boolean {
  return b.length >= 8 && PNG_SIGNATURE.every((v, i) => b[i] === v);
}

/** Finds .png, .png_ and .rpgmvp files under the folders (sub-folders too). Reads no file contents. */
export async function scanImages(game: GameInfo, o: { folders?: string[] } = {}): Promise<ScannedImage[]> {
  const byFile = new Map<string, ScannedImage>();
  const walk = async (abs: string, rel: string): Promise<void> => {
    let entries;
    try {
      entries = await readdir(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const r = `${rel}/${e.name}`;
      const full = path.join(abs, e.name);
      if (e.isDirectory()) {
        await walk(full, r);
        continue;
      }
      if (!e.isFile()) continue;
      const lower = e.name.toLowerCase();
      const enc = ENCRYPTED.find((x) => lower.endsWith(x));
      if (!enc && !lower.endsWith('.png')) continue;
      const file = enc ? r.slice(0, r.length - enc.length) + '.png' : r;
      const st = await stat(full);
      const item: ScannedImage = { file, sourceFile: r, encrypted: !!enc, bytes: st.size, mtimeMs: st.mtimeMs };
      const had = byFile.get(file);
      // When both a plain and an encrypted copy exist, keep the one the game loads.
      if (!had || had.encrypted !== game.encryptedImages) byFile.set(file, item);
    }
  };
  for (const folder of o.folders ?? IMAGE_FOLDERS) {
    const abs = path.join(game.contentDir, ...folder.split('/'));
    if (existsSync(abs)) await walk(abs, folder);
  }
  return [...byFile.values()].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

/** Bytes of a picture as a plain PNG (decrypted when needed). */
export async function readImage(game: GameInfo, sourceFile: string): Promise<Uint8Array> {
  let data: Uint8Array = new Uint8Array(await readFile(path.join(game.contentDir, ...sourceFile.split("/"))));
  if (ENCRYPTED.some((x) => sourceFile.toLowerCase().endsWith(x))) {
    if (!game.encryptionKey) throw new Error(`암호화 키가 없어 그림을 풀 수 없습니다: ${sourceFile}`);
    try {
      data = decryptAsset(data, game.encryptionKey);
    } catch {
      throw new Error(`PNG 파일이 아닙니다: ${sourceFile}`);
    }
  }
  if (!isPng(data)) throw new Error(`PNG 파일이 아닙니다: ${sourceFile}`);
  return data;
}

/** Width and height from the IHDR chunk. */
export function pngSize(png: Uint8Array): { width: number; height: number } {
  if (!isPng(png) || png.length < 24) throw new Error('PNG 파일이 아닙니다');
  const v = new DataView(png.buffer, png.byteOffset, png.byteLength);
  return { width: v.getUint32(16), height: v.getUint32(20) };
}

function eventLists(json: unknown, file: string): unknown[][] {
  const out: unknown[][] = [];
  const push = (l: unknown) => { if (Array.isArray(l)) out.push(l); };
  const name = path.basename(file);
  if (/^Map\d+\.json$/i.test(name)) {
    const events = (json as { events?: unknown[] })?.events;
    for (const ev of Array.isArray(events) ? events : []) {
      for (const p of (ev as { pages?: unknown[] } | null)?.pages ?? []) push((p as { list?: unknown })?.list);
    }
  } else if (name === 'CommonEvents.json' && Array.isArray(json)) {
    for (const ce of json) push((ce as { list?: unknown } | null)?.list);
  } else if (name === 'Troops.json' && Array.isArray(json)) {
    for (const t of json) for (const p of (t as { pages?: unknown[] } | null)?.pages ?? []) push((p as { list?: unknown })?.list);
  }
  return out;
}

/** How many Show Picture (231) commands use each picture, from the project's original copy. Keys 'img/pictures/<name>.png'. */
export async function pictureUsage(projectDir: string): Promise<Record<string, number>> {
  const meta = await openProject(projectDir);
  const dataDir = path.join(originalDir(projectDir, meta), 'data');
  const out: Record<string, number> = {};
  let names: string[];
  try {
    names = (await readdir(dataDir)).filter((n) => /^(Map\d+|CommonEvents|Troops)\.json$/i.test(n));
  } catch {
    return out;
  }
  for (const n of names) {
    let json: unknown;
    try {
      json = await readJsonFile(path.join(dataDir, n));
    } catch {
      continue;
    }
    for (const list of eventLists(json, n)) {
      for (const cmd of list) {
        const c = cmd as { code?: unknown; parameters?: unknown[] } | null;
        const pic = c?.code === 231 && Array.isArray(c.parameters) ? c.parameters[1] : undefined;
        if (typeof pic !== 'string' || pic === '') continue;
        const key = `img/pictures/${pic}.png`;
        out[key] = (out[key] ?? 0) + 1;
      }
    }
  }
  return out;
}

interface CatalogRecord { sourceFile: string; bytes: number; mtimeMs: number; width: number; height: number; hash: string; invalid?: true }
interface CatalogFile { version: number; entries: Record<string, CatalogRecord> }

/**
 * The game's pictures with their size and hash. Remembers them in <projectDir>/images/catalog.json by
 * path, size and modified time, so a later list() reads only new or changed files.
 */
export class ImageCatalog {
  /** Files read by the last list() calls (tests check the cache with it). */
  reads = 0;
  private usage: Record<string, number> | null = null;
  private scanned = new Map<string, ScannedImage>();

  constructor(private readonly projectDir: string, private readonly game: GameInfo, private readonly o: { folders?: string[] } = {}) {}

  private get cacheFile(): string {
    return path.join(this.projectDir, 'images', 'catalog.json');
  }

  private async loadCache(): Promise<CatalogFile> {
    try {
      if (existsSync(this.cacheFile)) {
        const c = (await readJsonFile(this.cacheFile)) as CatalogFile;
        if (c && c.version === CATALOG_VERSION && c.entries && typeof c.entries === 'object') return c;
      }
    } catch {
      // a broken cache is rebuilt
    }
    return { version: CATALOG_VERSION, entries: {} };
  }

  async list(): Promise<ImageEntry[]> {
    const found = await scanImages(this.game, { folders: this.o.folders });
    this.scanned = new Map(found.map((f) => [f.file, f]));
    const cache = await this.loadCache();
    const fresh = (f: ScannedImage) => {
      const c = cache.entries[f.file];
      return c && c.sourceFile === f.sourceFile && c.bytes === f.bytes && c.mtimeMs === f.mtimeMs;
    };
    const stale = found.filter((f) => !fresh(f));
    for (let i = 0; i < stale.length; i += READ_AT_ONCE) {
      await Promise.all(stale.slice(i, i + READ_AT_ONCE).map(async (f) => {
        this.reads++;
        const base = { sourceFile: f.sourceFile, bytes: f.bytes, mtimeMs: f.mtimeMs };
        try {
          const png = await readImage(this.game, f.sourceFile);
          cache.entries[f.file] = { ...base, ...pngSize(png), hash: createHash('sha1').update(png).digest('hex') };
        } catch {
          // Empty or broken files are remembered as such so they are not read again.
          cache.entries[f.file] = { ...base, width: 0, height: 0, hash: '', invalid: true };
        }
      }));
    }
    const live = new Set(found.map((f) => f.file));
    const dropped = Object.keys(cache.entries).filter((k) => !live.has(k));
    for (const k of dropped) delete cache.entries[k];
    if (stale.length > 0 || dropped.length > 0) await writeJsonFile(this.cacheFile, cache);

    if (!this.usage) {
      try {
        this.usage = await pictureUsage(this.projectDir);
      } catch {
        this.usage = {};
      }
    }
    const usage = this.usage;
    return found.flatMap((f): ImageEntry[] => {
      const c = cache.entries[f.file];
      if (!c || c.invalid) return [];
      return [{
        file: f.file, sourceFile: f.sourceFile, encrypted: f.encrypted, width: c.width, height: c.height, bytes: f.bytes, hash: c.hash,
        usedByEvents: usage[f.file] ?? 0, status: 'none',
      }];
    });
  }

  /** The plain PNG bytes of a listed picture. */
  async bytes(file: string): Promise<Uint8Array> {
    let f = this.scanned.get(file);
    if (!f) {
      await this.list();
      f = this.scanned.get(file);
    }
    if (!f) throw new Error(`없는 그림입니다: ${file}`);
    return readImage(this.game, f.sourceFile);
  }
}
