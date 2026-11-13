import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import type { TextUnit, TranslationEntry } from '../types.js';
import { readJsonFile, writeJsonFile } from '../util/json.js';

/**
 * A summary of what one build put into its patch, kept to compare with the next build.
 * translations: unit id → first 12 hex chars of sha1(target); images: picture file → hash of the patched PNG;
 * files: zip paths; extras: summaries other parts of the app add (key → lines).
 */
export interface BuildSnapshot {
  number: number; createdAt: string; version: string;
  translations: Record<string, string>; images: Record<string, string>; files: string[]; extras: Record<string, string[]>;
}

export const SNAPSHOT_FILE = 'snapshot.json';

/** builds/NNN of a build number. */
export function buildFolder(projectDir: string, number: number): string {
  return path.join(projectDir, 'builds', String(number).padStart(3, '0'));
}

/** Translations that can go into a patch: a target, and not an error or a refusal. */
export function patchable(e: TranslationEntry): boolean {
  return e.target !== null && e.status !== 'error' && e.status !== 'declined';
}

export function takeSnapshot(o: {
  number: number; version: string; units: TextUnit[]; entryOf: (id: string) => TranslationEntry;
  images: Record<string, string>; files: string[]; extras: Record<string, string[]>; createdAt?: string;
}): BuildSnapshot {
  const translations: Record<string, string> = {};
  for (const u of o.units) {
    const e = o.entryOf(u.id);
    if (patchable(e)) translations[u.id] = createHash('sha1').update(e.target!).digest('hex').slice(0, 12);
  }
  return {
    number: o.number, createdAt: o.createdAt ?? new Date().toISOString(), version: o.version,
    translations, images: { ...o.images }, files: [...o.files].sort(), extras: structuredClone(o.extras),
  };
}

export async function saveSnapshot(projectDir: string, s: BuildSnapshot): Promise<void> {
  await writeJsonFile(path.join(buildFolder(projectDir, s.number), SNAPSHOT_FILE), s);
}

export async function loadSnapshot(projectDir: string, number: number): Promise<BuildSnapshot | null> {
  const file = path.join(buildFolder(projectDir, number), SNAPSHOT_FILE);
  try {
    return existsSync(file) ? ((await readJsonFile(file)) as BuildSnapshot) : null;
  } catch {
    return null;
  }
}

/** Numbers of finished builds (those with a manifest), newest first. */
export async function finishedBuilds(projectDir: string): Promise<number[]> {
  const dir = path.join(projectDir, 'builds');
  if (!existsSync(dir)) return [];
  const names = (await readdir(dir)).filter((n) => /^\d+$/.test(n) && existsSync(path.join(dir, n, 'manifest.json')));
  return names.map(Number).sort((a, b) => b - a);
}
