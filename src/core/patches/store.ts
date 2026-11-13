import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { readJsonFile, writeJsonFile } from '../util/json.js';
import type { Patch } from './types.js';

export const PATCHES_FILE = 'patches.json';

/** The project's patches (an empty list when there is no patches.json). */
export async function loadPatches(projectDir: string): Promise<Patch[]> {
  const file = path.join(projectDir, PATCHES_FILE);
  if (!existsSync(file)) return [];
  const raw = await readJsonFile(file);
  return Array.isArray(raw) ? (raw as Patch[]) : [];
}

export async function savePatches(projectDir: string, patches: Patch[]): Promise<void> {
  await writeJsonFile(path.join(projectDir, PATCHES_FILE), patches);
}

export function newPatchId(): string {
  return `p-${randomUUID().slice(0, 8)}`;
}
