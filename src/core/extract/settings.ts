// extract.json: what the user changed about extraction, and which extractor made units.json.
// extraStrings are strings without Japanese that are translated anyway (an English option name, say); they are
// taken only where they are a whole plugin parameter value or key name. extractorVersion says which version of
// the extractor wrote units.json, so a project made before an extractor change is extracted again when opened.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { readJsonFile, writeJsonFile } from '../util/json.js';

export const EXTRACT_FILE = 'extract.json';

/**
 * Raise when the extractor finds new units in games it already read: projects with a lower number in
 * extract.json are extracted again from their original copy when opened (unit ids do not change, so
 * translations, decisions and the action log stay).
 */
export const EXTRACTOR_VERSION = 1;

export interface ExtractSettings {
  extraStrings: string[];
  /** Missing in projects made before extract.json existed: counts as 0. */
  extractorVersion?: number;
}

export async function loadExtractSettings(projectDir: string): Promise<ExtractSettings> {
  const file = path.join(projectDir, EXTRACT_FILE);
  if (!existsSync(file)) return { extraStrings: [] };
  let raw: unknown;
  try {
    raw = await readJsonFile(file);
  } catch {
    return { extraStrings: [] };
  }
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const out: ExtractSettings = {
    extraStrings: Array.isArray(o.extraStrings) ? o.extraStrings.filter((s): s is string => typeof s === 'string' && s !== '') : [],
  };
  if (typeof o.extractorVersion === 'number') out.extractorVersion = o.extractorVersion;
  return out;
}

export async function saveExtractSettings(projectDir: string, s: ExtractSettings): Promise<void> {
  await writeJsonFile(path.join(projectDir, EXTRACT_FILE), s);
}

/** Whether units.json was written by an older extractor than this one. */
export function extractorOutdated(s: ExtractSettings): boolean {
  return (s.extractorVersion ?? 0) < EXTRACTOR_VERSION;
}
