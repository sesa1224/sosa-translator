import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { writeJsonFile } from '../util/json.js';
import { openProject, originalDir } from './project.js';

/** Folders whose files a game loads by name (pictures, sounds, movies). */
const ASSET_DIRS = ['img', 'audio', 'movies'];
export const FILES_LIST = 'files.json';
export const INDEX_HTML = 'index.html';
export const TOP_PACKAGE = 'package.top.json';
export const GAMEFONT_CSS = 'fonts/gamefont.css';

/** Relative paths ('/'-separated) of every file under img/, audio/ and movies/ of contentDir. */
export async function listGameFiles(contentDir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (abs: string, rel: string): Promise<void> => {
    const entries = await readdir(abs, { withFileTypes: true });
    for (const e of entries) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) await walk(path.join(abs, e.name), r);
      else if (e.isFile()) out.push(r);
    }
  };
  for (const d of ASSET_DIRS) {
    const abs = path.join(contentDir, d);
    if (existsSync(abs)) await walk(abs, d);
  }
  return out.sort();
}

/** Copies the helper files that are missing in dst from the game. Returns the names added. Reads the game only. */
export async function fillOriginals(topDir: string, contentDir: string, dst: string): Promise<string[]> {
  const added: string[] = [];
  await mkdir(dst, { recursive: true });
  if (!existsSync(path.join(dst, FILES_LIST))) {
    await writeJsonFile(path.join(dst, FILES_LIST), await listGameFiles(contentDir));
    added.push(FILES_LIST);
  }
  const copies: [string, string][] = [[path.join(contentDir, 'index.html'), INDEX_HTML], [path.join(topDir, 'package.json'), TOP_PACKAGE], [path.join(contentDir, 'fonts', 'gamefont.css'), GAMEFONT_CSS]];
  for (const [src, name] of copies) {
    if (existsSync(path.join(dst, name)) || !existsSync(src)) continue;
    await mkdir(path.dirname(path.join(dst, name)), { recursive: true });
    await copyFile(src, path.join(dst, name));
    added.push(name);
  }
  return added;
}

/**
 * Makes sure original/<current>/ holds files.json, index.html and package.top.json, reading the
 * missing ones from meta.gameDir. Without the game folder nothing is added (missingGameDir: true).
 */
export async function ensureOriginals(projectDir: string): Promise<{ added: string[]; missingGameDir: boolean }> {
  const meta = await openProject(projectDir);
  const dst = originalDir(projectDir, meta);
  const needed = [FILES_LIST, INDEX_HTML, TOP_PACKAGE, GAMEFONT_CSS].filter((n) => !existsSync(path.join(dst, n)));
  if (needed.length === 0) return { added: [], missingGameDir: false };
  if (!existsSync(meta.gameDir)) return { added: [], missingGameDir: true };
  const contentDir = path.join(meta.gameDir, ...meta.contentPrefix.split('/').filter(Boolean));
  try {
    return { added: await fillOriginals(meta.gameDir, contentDir, dst), missingGameDir: false };
  } catch {
    return { added: [], missingGameDir: true };
  }
}
