import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { strFromU8, unzipSync, zipSync } from 'fflate';
import { checkAll, DEFAULT_RULES } from '../check/format.js';
import { loadDecisions } from '../decisions/store.js';
import { openProject } from '../project/project.js';
import type { TranslationStore } from '../store/translations.js';
import type { TextUnit, Warning } from '../types.js';
import { writeJsonFile } from '../util/json.js';
import { applyTranslationsDetailed } from './apply.js';
import { TOP_PACKAGE_KEY, titleFiles } from './title.js';

export interface BuildResult { number: number; zipPath: string; files: { path: string; sha1: string }[]; skippedErrors: number; warnings: Warning[] }

/** The translation of System.json gameTitle that would go into the patch, or null. */
function gameTitleTarget(units: TextUnit[], store: TranslationStore): string | null {
  const unit = units.find((u) => u.refs.some((r) => r.type === 'value' && r.file === 'data/System.json' && r.path.length === 1 && r.path[0] === 'gameTitle'));
  if (!unit) return null;
  const e = store.get(unit.id);
  return e.target !== null && e.status !== 'error' && e.status !== 'declined' ? e.target : null;
}

function sha1(data: Uint8Array): string {
  return createHash('sha1').update(data).digest('hex');
}

async function nextBuildNumber(buildsDir: string): Promise<number> {
  if (!existsSync(buildsDir)) return 1;
  const nums = (await readdir(buildsDir)).filter((n) => /^\d+$/.test(n)).map(Number);
  return nums.length === 0 ? 1 : Math.max(...nums) + 1;
}

/** Re-reads the zip and checks every manifest file is present, has the same sha1, and .json files parse. */
function verifyZip(zip: Uint8Array, files: { path: string; sha1: string }[]): void {
  const entries = unzipSync(zip);
  for (const f of files) {
    const data = entries[f.path];
    if (!data || sha1(data) !== f.sha1) throw new Error(`패치 검증 실패: ${f.path}`);
    if (f.path.toLowerCase().endsWith('.json')) {
      try {
        JSON.parse(strFromU8(data));
      } catch {
        throw new Error(`패치 검증 실패: ${f.path}`);
      }
    }
  }
  const extra = Object.keys(entries).find((p) => !files.some((f) => f.path === p));
  if (extra !== undefined) throw new Error(`패치 검증 실패: ${extra}`);
}

/**
 * Checks translations (errors are marked and skipped), applies the rest, and writes
 * builds/NNN/{patch/, manifest.json, <name>_patch_NNN.zip}. Only changed files are included.
 */
export async function buildPatch(projectDir: string, units: TextUnit[], store: TranslationStore): Promise<BuildResult> {
  const meta = await openProject(projectDir);
  const decisions = await loadDecisions(projectDir);
  const checked = checkAll(units, store, DEFAULT_RULES, decisions);
  const skippedErrors = checked.filter((c) => c.issues.some((i) => i.severity === 'error')).length;

  const { files: changed, warnings } = await applyTranslationsDetailed(projectDir, units, store, { decisions });
  for (const [file, text] of await titleFiles(projectDir, gameTitleTarget(units, store))) changed.set(file, text);
  if (changed.size === 0) throw new Error('바뀐 파일이 없습니다');

  const buildsDir = path.join(projectDir, 'builds');
  const number = await nextBuildNumber(buildsDir);
  const tag = String(number).padStart(3, '0');
  const buildDir = path.join(buildsDir, tag);
  const patchDir = path.join(buildDir, 'patch');

  const files: { path: string; sha1: string }[] = [];
  const zipEntries: Record<string, Uint8Array> = {};
  for (const [file, text] of changed) {
    const zipPath = file === TOP_PACKAGE_KEY ? 'package.json' : meta.contentPrefix + file;
    const data = new TextEncoder().encode(text);
    const abs = path.join(patchDir, ...zipPath.split('/'));
    await mkdir(path.dirname(abs), { recursive: true });
    await writeFile(abs, data);
    files.push({ path: zipPath, sha1: sha1(data) });
    zipEntries[zipPath] = data;
  }

  await writeJsonFile(path.join(buildDir, 'manifest.json'), {
    number,
    createdAt: new Date().toISOString(),
    version: meta.current,
    files,
  });

  const zip = zipSync(zipEntries, { level: 9 });
  const zipPath = path.join(buildDir, `${meta.name}_patch_${tag}.zip`);
  await writeFile(zipPath, zip);
  verifyZip(new Uint8Array(await readFile(zipPath)), files);

  return { number, zipPath, files, skippedErrors, warnings };
}
