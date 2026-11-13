// The project folder: project.json (name, engine, game folder, versions) and original/<version>/, a copy of
// the game's data and plugin files (plus the helper files in originals.ts). Text is always read from the copy;
// pictures, fonts and test play still read the game folder, and nothing ever writes to it.
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { detectGame } from '../engine/detect.js';
import type { Engine, GameInfo } from '../types.js';
import { readJsonFile, writeJsonFile } from '../util/json.js';
import { fillOriginals } from './originals.js';

export interface ProjectMeta {
  name: string;
  engine: Engine;
  gameDir: string;
  contentPrefix: string;
  sourceLang: 'ja';
  targetLang: 'ko';
  /** label and gameDir were added with game updates; older projects have neither. */
  versions: { id: string; importedAt: string; label?: string; gameDir?: string }[];
  current: string;
}

const PROJECT_FILE = 'project.json';

async function listFiles(dir: string, ext: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries.filter((e) => e.isFile() && e.name.toLowerCase().endsWith(ext)).map((e) => e.name).sort();
}

async function copyInto(srcDir: string, dstDir: string, names: string[]): Promise<void> {
  if (names.length === 0) return;
  await mkdir(dstDir, { recursive: true });
  for (const n of names) await copyFile(path.join(srcDir, n), path.join(dstDir, n));
}

/** Creates a project: copies data/*.json, js/plugins.js, js/plugins/*.js to original/v1 and writes project.json. Reads the game only. */
export async function createProject(gameDir: string, projectDir: string, name: string): Promise<ProjectMeta> {
  if (existsSync(projectDir) && (await readdir(projectDir)).length > 0) {
    throw new Error('프로젝트 폴더가 비어있지 않습니다');
  }
  const game = await detectGame(path.resolve(gameDir));
  const meta: ProjectMeta = {
    name,
    engine: game.engine,
    gameDir: game.topDir,
    contentPrefix: game.contentPrefix,
    sourceLang: 'ja',
    targetLang: 'ko',
    versions: [{ id: 'v1', importedAt: new Date().toISOString(), label: 'v1', gameDir: game.topDir }],
    current: 'v1',
  };

  const dst = path.join(projectDir, 'original', meta.current);
  const src = game.contentDir;
  await copyInto(path.join(src, 'data'), path.join(dst, 'data'), await listFiles(path.join(src, 'data'), '.json'));
  if (existsSync(path.join(src, 'js', 'plugins.js'))) await copyInto(path.join(src, 'js'), path.join(dst, 'js'), ['plugins.js']);
  await copyInto(path.join(src, 'js', 'plugins'), path.join(dst, 'js', 'plugins'), await listFiles(path.join(src, 'js', 'plugins'), '.js'));
  await fillOriginals(game.topDir, src, dst);

  await writeJsonFile(path.join(projectDir, PROJECT_FILE), meta);
  return meta;
}

/**
 * Copies what the project keeps of a game into dst: data/*.json, js/plugins.js, js/plugins/*.js and the helper files
 * (files.json, index.html, package.top.json, fonts/gamefont.css). Reads the game only.
 */
export async function copyOriginals(game: GameInfo, dst: string): Promise<void> {
  const src = game.contentDir;
  await copyInto(path.join(src, 'data'), path.join(dst, 'data'), await listFiles(path.join(src, 'data'), '.json'));
  if (existsSync(path.join(src, 'js', 'plugins.js'))) await copyInto(path.join(src, 'js'), path.join(dst, 'js'), ['plugins.js']);
  await copyInto(path.join(src, 'js', 'plugins'), path.join(dst, 'js', 'plugins'), await listFiles(path.join(src, 'js', 'plugins'), '.js'));
  await fillOriginals(game.topDir, src, dst);
}

export async function openProject(projectDir: string): Promise<ProjectMeta> {
  const file = path.join(projectDir, PROJECT_FILE);
  if (!existsSync(file)) throw new Error(`프로젝트가 아닙니다: ${projectDir}`);
  return (await readJsonFile(file)) as ProjectMeta;
}

/** Folder holding the current original copy: <projectDir>/original/<current>. */
export function originalDir(projectDir: string, meta: ProjectMeta): string {
  return path.join(projectDir, 'original', meta.current);
}
