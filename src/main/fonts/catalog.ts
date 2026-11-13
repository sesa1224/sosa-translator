// Fonts the user can pick for the game preview and the game: system fonts, the game's fonts/ folder and the
// project's fonts/ folder. fontFile.ts reads a font's names and whether it has Hangul; fontEmbed.ts puts the
// chosen font (subset to the characters used) into patch builds.
import { existsSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readJsonFile, writeJsonFile } from '../../core/util/json.js';
import type { FontInfo } from '../../shared/api.js';
import { readFontInfo } from './fontFile.js';

const CACHE_VERSION = 1;

interface CacheEntry { size: number; mtimeMs: number; info: Omit<FontInfo, 'source'> | null }
interface CacheFile { version: number; entries: Record<string, CacheEntry> }

/** Windows font folders: the machine's and the current user's. */
export function systemFontDirs(): string[] {
  const windir = process.env.WINDIR ?? process.env.SystemRoot ?? 'C:\\Windows';
  const local = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
  return [path.join(windir, 'Fonts'), path.join(local, 'Microsoft', 'Windows', 'Fonts')];
}

async function loadCache(file: string): Promise<CacheFile> {
  try {
    if (existsSync(file)) {
      const c = (await readJsonFile(file)) as CacheFile;
      if (c && c.version === CACHE_VERSION && c.entries && typeof c.entries === 'object') return c;
    }
  } catch {
    // a broken cache is rebuilt
  }
  return { version: CACHE_VERSION, entries: {} };
}

async function fontFiles(dir: string): Promise<{ fonts: string[]; collections: number }> {
  if (!existsSync(dir)) return { fonts: [], collections: 0 };
  let names: string[];
  try {
    names = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name);
  } catch {
    return { fonts: [], collections: 0 };
  }
  const fonts: string[] = [];
  let collections = 0;
  for (const n of names) {
    const ext = path.extname(n).toLowerCase();
    if (ext === '.ttf' || ext === '.otf') fonts.push(path.join(dir, n));
    else if (ext === '.ttc') collections++;
  }
  return { fonts: fonts.sort(), collections };
}

/**
 * Lists .ttf/.otf fonts in the system folders, the game's fonts/ folder and the project's fonts folder.
 * .ttc collections are only counted. Font details are cached in cacheFile by path, size and modified time,
 * so a later call reads only new or changed files.
 */
export async function listFonts(o: {
  systemDirs: string[]; gameContentDir?: string; projectFontsDir?: string; cacheFile: string;
  /** Reads one file (tests wrap it to count reads). */
  readInfo?: (file: string) => Promise<FontInfo | null>;
}): Promise<{ fonts: FontInfo[]; skippedCollections: number }> {
  const read = o.readInfo ?? readFontInfo;
  const cache = await loadCache(o.cacheFile);
  const next: Record<string, CacheEntry> = {};
  let dirty = false;
  const fonts: FontInfo[] = [];
  const seen = new Set<string>();
  let skippedCollections = 0;

  const groups: [string, FontInfo['source']][] = [
    ...o.systemDirs.map((d): [string, FontInfo['source']] => [d, 'system']),
    ...(o.gameContentDir ? [[path.join(o.gameContentDir, 'fonts'), 'game'] as [string, FontInfo['source']]] : []),
    ...(o.projectFontsDir ? [[o.projectFontsDir, 'project'] as [string, FontInfo['source']]] : []),
  ];
  for (const [dir, source] of groups) {
    const found = await fontFiles(dir);
    skippedCollections += found.collections;
    for (const file of found.fonts) {
      const key = path.resolve(file);
      if (seen.has(key)) continue;
      seen.add(key);
      let st;
      try {
        st = await stat(file);
      } catch {
        continue;
      }
      const old = cache.entries[key];
      let entry: CacheEntry;
      if (old && old.size === st.size && old.mtimeMs === st.mtimeMs) entry = old;
      else {
        const info = await read(file);
        entry = { size: st.size, mtimeMs: st.mtimeMs, info: info ? { path: info.path, family: info.family, displayName: info.displayName, style: info.style, hasHangul: info.hasHangul } : null };
        dirty = true;
      }
      next[key] = entry;
      if (entry.info) fonts.push({ ...entry.info, path: file, source });
    }
  }
  if (Object.keys(cache.entries).some((k) => !(k in next))) dirty = true;
  if (dirty) {
    try {
      await writeJsonFile(o.cacheFile, { version: CACHE_VERSION, entries: next });
    } catch {
      // the list still works without a cache
    }
  }
  fonts.sort((a, b) => a.displayName.localeCompare(b.displayName, 'ko') || a.style.localeCompare(b.style) || a.path.localeCompare(b.path));
  return { fonts, skippedCollections };
}
