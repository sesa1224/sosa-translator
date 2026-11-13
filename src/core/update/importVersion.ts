// Game updates: takes a new version of the game into an existing project. diff.ts pairs old and new sentences,
// carry.ts carries translations over, rebase.ts moves patches onto the new original. The project files are
// backed up to backups/before-<version>/ first and the result is saved in updates/<version>.json; a rollback
// puts the backup back.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, rename, rm, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { DECISIONS_FILE, loadDecisions } from '../decisions/store.js';
import { detectGame } from '../engine/detect.js';
import { describeCommand } from '../events/describe.js';
import { loadNames } from '../events/names.js';
import { extractFromDir, loadUnits, UNITS_FILE } from '../extract/index.js';
import { getAtPath } from '../extract/plugins.js';
import { GLOSSARY_FILE, loadGlossary } from '../glossary/store.js';
import { readImage, scanImages, IMAGE_FOLDERS } from '../images/catalog.js';
import { IMAGES_FILE, loadImages } from '../images/store.js';
import { PATCHES_FILE, loadPatches } from '../patches/store.js';
import type { EventCommand, Patch } from '../patches/types.js';
import { FILES_LIST } from '../project/originals.js';
import { copyOriginals, openProject, originalDir, type ProjectMeta } from '../project/project.js';
import { TRANSLATIONS_FILE } from '../store/translations.js';
import type { Engine, TextUnit, TranslationEntry, Warning } from '../types.js';
import { readJsonFile, writeJsonFile } from '../util/json.js';
import { carryTranslations } from './carry.js';
import { diffUnits } from './diff.js';
import { rebasePatch } from './rebase.js';
import type { PatchMove, UpdateSummary, VersionInfo } from './types.js';

const PROJECT_FILE = 'project.json';
const PREVIEW_FILE = 'preview.json';
/** Project files an update rewrites or that later work may change; a rollback puts them all back. */
export const BACKUP_FILES = [PROJECT_FILE, UNITS_FILE, TRANSLATIONS_FILE, GLOSSARY_FILE, DECISIONS_FILE, PATCHES_FILE, IMAGES_FILE, PREVIEW_FILE];
export const NO_ROLLBACK = '되돌릴 수 있는 업데이트가 없어요';

const backupDir = (projectDir: string, id: string) => path.join(projectDir, 'backups', `before-${id}`);
const summaryFile = (projectDir: string, id: string) => path.join(projectDir, 'updates', `${id}.json`);

/** The project's versions with label and gameDir filled in for projects made before game updates existed. */
export function versionsOf(meta: ProjectMeta): VersionInfo[] {
  return meta.versions.map((v) => ({ id: v.id, label: v.label ?? v.id, importedAt: v.importedAt, gameDir: v.gameDir ?? meta.gameDir }));
}

const samePath = (a: string, b: string) => {
  const x = path.resolve(a);
  const y = path.resolve(b);
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
};

async function jsonNames(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  return (await readdir(dir)).filter((n) => n.toLowerCase().endsWith('.json')).map((n) => n.toLowerCase());
}

/** A version written in a title or folder name: 'ver1.03' → '1.03', 'v1.2' → '1.2', '1.0.3' → '1.0.3'. */
export function versionLabelIn(text: string): string | null {
  const m = /(?:ver\.?|version|v)\s*(\d+(?:\.\d+)+|\d+)/i.exec(text) ?? /(\d+(?:\.\d+)+)/.exec(text);
  return m ? m[1] : null;
}

function nextVersionId(meta: ProjectMeta, projectDir: string): string {
  let n = 1;
  for (const v of meta.versions) {
    const m = /^v(\d+)$/.exec(v.id);
    if (m) n = Math.max(n, Number(m[1]));
  }
  for (;;) {
    n++;
    const id = `v${n}`;
    if (!meta.versions.some((v) => v.id === id) && !existsSync(path.join(projectDir, 'original', id)) && !existsSync(path.join(projectDir, 'original', `${id}.tmp`))) return id;
  }
}

async function gameTitleOf(contentDir: string): Promise<string> {
  try {
    const sys = (await readJsonFile(path.join(contentDir, 'data', 'System.json'))) as { gameTitle?: unknown };
    return typeof sys.gameTitle === 'string' ? sys.gameTitle.trim() : '';
  } catch {
    return '';
  }
}

/**
 * Looks at a folder picked as the game's new version. Different engines, or data files that hardly overlap, mean it is
 * probably another game (sameGame: false with the reason). The folder of the current version is refused.
 */
export async function inspectNewVersion(projectDir: string, gameDir: string): Promise<
  { ok: true; engine: Engine; title: string; suggestedLabel: string; sameGame: boolean; overlap: number; reason?: string } | { ok: false; error: string }
> {
  let meta: ProjectMeta;
  try {
    meta = await openProject(projectDir);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  let game;
  try {
    game = await detectGame(path.resolve(gameDir));
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (samePath(game.topDir, meta.gameDir)) return { ok: false, error: '지금 버전과 같은 폴더예요' };
  const title = await gameTitleOf(game.contentDir);
  const mine = new Set(await jsonNames(path.join(originalDir(projectDir, meta), 'data')));
  const theirs = await jsonNames(path.join(game.contentDir, 'data'));
  const common = theirs.filter((n) => mine.has(n)).length;
  const smaller = Math.min(mine.size, theirs.length);
  const overlap = smaller === 0 ? 0 : common / smaller;
  const label = versionLabelIn(title) ?? versionLabelIn(path.basename(game.topDir)) ?? nextVersionId(meta, projectDir);
  const out = { ok: true as const, engine: game.engine, title, suggestedLabel: label, overlap };
  if (game.engine !== meta.engine) return { ...out, sameGame: false, reason: `엔진이 달라요(지금 ${meta.engine}, 새 폴더 ${game.engine})` };
  if (overlap < 0.5) return { ...out, sameGame: false, reason: '데이터 파일이 거의 겹치지 않아요' };
  return { ...out, sameGame: true };
}

async function readJsonOr(file: string): Promise<unknown> {
  try {
    return await readJsonFile(file);
  } catch {
    return undefined;
  }
}

/** Copies the project files that exist into dir (replacing an earlier copy there). */
async function backup(projectDir: string, dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  for (const f of BACKUP_FILES) if (existsSync(path.join(projectDir, f))) await copyFile(path.join(projectDir, f), path.join(dir, f));
}

/** Puts the backed-up files back; files the backup does not have did not exist then and are removed. */
async function restore(projectDir: string, dir: string): Promise<void> {
  for (const f of BACKUP_FILES) {
    const saved = path.join(dir, f);
    if (existsSync(saved)) await copyFile(saved, path.join(projectDir, f));
    else await rm(path.join(projectDir, f), { force: true });
  }
}

const sha1 = (d: Uint8Array) => createHash('sha1').update(d).digest('hex');

/** Pictures with a recipe whose original changed or is gone, and pictures the old version did not have. */
async function compareImages(projectDir: string, oldRoot: string, game: Awaited<ReturnType<typeof detectGame>>): Promise<UpdateSummary['images']> {
  const images = await loadImages(projectDir);
  const scanned = await scanImages(game, { folders: images.folders ?? IMAGE_FOLDERS });
  const byFile = new Map(scanned.map((s) => [s.file, s]));
  const changed: string[] = [];
  let removed = 0;
  for (const recipe of Object.values(images.recipes)) {
    let s = byFile.get(recipe.file);
    if (!s) {
      // A recipe for a picture outside the folders looked at: look for it directly.
      const more = await scanImages(game, { folders: [path.posix.dirname(recipe.file)] });
      s = more.find((x) => x.file === recipe.file);
    }
    if (!s) {
      removed++;
      continue;
    }
    let hash = '';
    try {
      hash = sha1(await readImage(game, s.sourceFile));
    } catch {
      hash = '';   // unreadable now: treat as changed so it gets a look
    }
    if (hash !== recipe.baseHash) changed.push(recipe.file);
  }
  const oldList = await readJsonOr(path.join(oldRoot, FILES_LIST));
  const known = new Set(Array.isArray(oldList) ? oldList.filter((x): x is string => typeof x === 'string') : []);
  const added = scanned.filter((s) => !known.has(s.sourceFile)).length;
  return { changed: changed.sort(), added, removed };
}

export interface ImportOptions {
  /** Extracts the units of an original copy (tests make it fail). */
  extract?: (root: string) => Promise<{ units: TextUnit[]; warnings: Warning[] }>;
}

/**
 * Takes a new version of the game. Everything is worked out first (the new original copy under a temporary name,
 * the units, carried translations and moved patches); only then are the project files written. If anything fails
 * the project files are put back from the backup and the new copy is removed, so the project stays as it was.
 * No translation is removed: entries of sentences the new version lacks stay in translations.json.
 */
export async function importVersion(projectDir: string, gameDir: string, label: string, o: ImportOptions = {}): Promise<UpdateSummary> {
  const meta = await openProject(projectDir);
  const game = await detectGame(path.resolve(gameDir));
  const id = nextVersionId(meta, projectDir);
  const fromInfo = versionsOf(meta).find((v) => v.id === meta.current);
  const oldRoot = originalDir(projectDir, meta);
  const finalRoot = path.join(projectDir, 'original', id);
  const tmpRoot = path.join(projectDir, 'original', `${id}.tmp`);
  const bdir = backupDir(projectDir, id);
  const hadBackups = existsSync(path.join(projectDir, 'backups'));
  const hadUpdates = existsSync(path.join(projectDir, 'updates'));

  await backup(projectDir, bdir);
  let wrote = false;
  try {
    await rm(tmpRoot, { recursive: true, force: true });
    await copyOriginals(game, tmpRoot);
    const { units: newUnits, warnings } = await (o.extract ?? extractFromDir)(tmpRoot);

    const oldUnits = await loadUnits(projectDir);
    const store = (await readJsonOr(path.join(projectDir, TRANSLATIONS_FILE))) as Record<string, TranslationEntry> | undefined;
    const entries = store && typeof store === 'object' ? store : {};
    const decisions = await loadDecisions(projectDir);
    const glossary = await loadGlossary(projectDir);
    const diff = diffUnits(oldUnits, newUnits);
    const carried = carryTranslations({
      diff, oldUnits, newUnits, entries, decisions, fromVersion: meta.current, speakerPattern: glossary.rules.speakerPattern, glossary,
    });

    // Patches: moved to the new numbers where every op finds its place.
    const names = await loadNames(projectDir);
    const describe = (c: EventCommand) => describeCommand(c, names);
    const patches = await loadPatches(projectDir);
    const fileCache = new Map<string, unknown>();
    const readData = async (root: string, file: string) => {
      const key = `${root}\u0000${file}`;
      if (!fileCache.has(key)) fileCache.set(key, await readJsonOr(path.join(root, ...file.split('/'))));
      return fileCache.get(key);
    };
    const listAt = (root: unknown, p: Parameters<typeof getAtPath>[1]): EventCommand[] | undefined => {
      try {
        const v = getAtPath(root, p);
        return Array.isArray(v) ? (v as EventCommand[]) : undefined;
      } catch {
        return undefined;
      }
    };
    const moves: PatchMove[] = [];
    const nextPatches: Patch[] = [];
    for (const p of patches) {
      const b = p.body;
      const r = b.kind === 'event'
        ? rebasePatch(p, { oldList: listAt(await readData(oldRoot, b.file), b.listPath), newList: listAt(await readData(tmpRoot, b.file), b.listPath), describe })
        : b.kind === 'json'
          ? rebasePatch(p, { oldJson: await readData(oldRoot, b.file), newJson: await readData(tmpRoot, b.file), describe })
          : rebasePatch(p, { describe });
      nextPatches.push(r.patch);
      moves.push({ id: p.id, title: p.title, result: r.result, ...(r.reason !== undefined ? { reason: r.reason } : {}) });
    }

    const hasTarget = (uid: string) => (entries[uid]?.target ?? null) !== null;
    const oldKeys = new Set(oldUnits.map((u) => u.decisionKey).filter((k): k is string => k !== undefined));
    const newGroups = new Set(newUnits.filter((u) => u.needsDecision && u.decisionKey !== undefined && !oldKeys.has(u.decisionKey) && !carried.decisions[u.decisionKey]).map((u) => u.decisionKey!));

    const summary: UpdateSummary = {
      from: meta.current, to: id, fromLabel: fromInfo?.label ?? meta.current, toLabel: label,
      kept: diff.kept.length, keptTranslated: diff.kept.filter(hasTarget).length,
      added: diff.added.length, changed: diff.changed.length, carried: carried.carried,
      removed: diff.removed.length, removedTranslated: diff.removed.filter(hasTarget).length,
      patches: moves,
      images: await compareImages(projectDir, oldRoot, game),
      decisions: { newGroups: newGroups.size },
      warnings,
    };

    const nextMeta: ProjectMeta = {
      ...meta,
      engine: game.engine,
      gameDir: game.topDir,
      contentPrefix: game.contentPrefix,
      // Older entries get their label and folder written out now, while meta.gameDir still names their folder.
      versions: [...versionsOf(meta), { id, label, importedAt: new Date().toISOString(), gameDir: game.topDir }],
      current: id,
    };

    // Everything is known: write it.
    wrote = true;
    await rename(tmpRoot, finalRoot);
    await writeJsonFile(path.join(projectDir, UNITS_FILE), newUnits);
    await writeJsonFile(path.join(projectDir, TRANSLATIONS_FILE), carried.entries);
    if (Object.keys(carried.decisions).length > 0 || existsSync(path.join(projectDir, DECISIONS_FILE))) await writeJsonFile(path.join(projectDir, DECISIONS_FILE), carried.decisions);
    if (patches.length > 0 || existsSync(path.join(projectDir, PATCHES_FILE))) await writeJsonFile(path.join(projectDir, PATCHES_FILE), nextPatches);
    await writeJsonFile(summaryFile(projectDir, id), summary);
    await writeJsonFile(path.join(projectDir, PROJECT_FILE), nextMeta);
    return summary;
  } catch (e) {
    if (wrote) await restore(projectDir, bdir).catch(() => undefined);
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
    await rm(finalRoot, { recursive: true, force: true }).catch(() => undefined);
    await rm(summaryFile(projectDir, id), { force: true }).catch(() => undefined);
    await rm(bdir, { recursive: true, force: true }).catch(() => undefined);
    if (!hadBackups) await rmdir(path.join(projectDir, 'backups')).catch(() => undefined);
    if (!hadUpdates) await rmdir(path.join(projectDir, 'updates')).catch(() => undefined);
    throw e;
  }
}

/**
 * Undoes the latest update: the project files come back from the backup taken before it, and the version's original
 * copy and summary are removed. The backup folder is kept under another name. Only the newest imported version can be
 * rolled back, and only while its backup is there.
 */
export async function rollbackVersion(projectDir: string): Promise<{ restored: string }> {
  const meta = await openProject(projectDir);
  const last = meta.versions[meta.versions.length - 1];
  const bdir = backupDir(projectDir, meta.current);
  if (!last || last.id !== meta.current || meta.versions.length < 2 || !existsSync(path.join(bdir, PROJECT_FILE))) throw new Error(NO_ROLLBACK);
  const before = (await readJsonFile(path.join(bdir, PROJECT_FILE))) as ProjectMeta;
  await restore(projectDir, bdir);
  await rm(path.join(projectDir, 'original', meta.current), { recursive: true, force: true });
  await rm(summaryFile(projectDir, meta.current), { force: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await rename(bdir, path.join(projectDir, 'backups', `rolled-back-${meta.current}-${stamp}`));
  return { restored: before.current };
}

/** The summary of an update (default: the current version's), or null when that version was not imported as an update. */
export async function readUpdateSummary(projectDir: string, versionId?: string): Promise<UpdateSummary | null> {
  const id = versionId ?? (await openProject(projectDir)).current;
  const file = summaryFile(projectDir, id);
  if (!existsSync(file)) return null;
  try {
    return (await readJsonFile(file)) as UpdateSummary;
  } catch {
    return null;
  }
}

