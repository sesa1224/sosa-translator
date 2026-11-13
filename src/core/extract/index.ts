import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { openProject, originalDir } from '../project/project.js';
import type { TextUnit, Warning } from '../types.js';
import { readJsonFile, writeJsonFile } from '../util/json.js';
import { extractFromDataFile } from './database.js';
import type { RawUnit } from './events.js';
import { extractFromPlugins, parsePluginsFile } from './plugins.js';

export const UNITS_FILE = 'units.json';

function unitId(kind: string, speaker: string | undefined, source: string): string {
  return createHash('sha1').update(`${kind}\u0000${speaker ?? ''}\u0000${source}`).digest('hex').slice(0, 16);
}

/** Merges raw units with the same kind + speaker + source, keeping first-seen order. */
export function mergeUnits(raw: RawUnit[]): TextUnit[] {
  const byId = new Map<string, TextUnit>();
  for (const r of raw) {
    const id = unitId(r.kind, r.speaker, r.source);
    let u = byId.get(id);
    if (!u) {
      u = { id, kind: r.kind, source: r.source, needsDecision: r.needsDecision, refs: [] };
      if (r.speaker !== undefined) u.speaker = r.speaker;
      if (r.decisionKey !== undefined) u.decisionKey = r.decisionKey;
      byId.set(id, u);
    }
    u.needsDecision ||= r.needsDecision;
    u.refs.push(r.ref);
  }
  return [...byId.values()];
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Extracts all units from original/<current>, writes units.json. Broken files become warnings. */
export async function extractAll(projectDir: string): Promise<{ units: TextUnit[]; warnings: Warning[] }> {
  const meta = await openProject(projectDir);
  const root = originalDir(projectDir, meta);
  const raw: RawUnit[] = [];
  const warnings: Warning[] = [];

  const dataDir = path.join(root, 'data');
  const dataFiles = existsSync(dataDir)
    ? (await readdir(dataDir)).filter((n) => n.toLowerCase().endsWith('.json')).sort()
    : [];
  for (const name of dataFiles) {
    let json: unknown;
    try {
      json = await readJsonFile(path.join(dataDir, name));
    } catch (e) {
      warnings.push({ file: `data/${name}`, message: `JSON 을 읽을 수 없습니다: ${errorText(e)}` });
      continue;
    }
    raw.push(...extractFromDataFile(name, json));
  }

  const pluginsPath = path.join(root, 'js', 'plugins.js');
  if (existsSync(pluginsPath)) {
    try {
      let text = await readFile(pluginsPath, 'utf8');
      if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
      raw.push(...extractFromPlugins(parsePluginsFile(text).plugins));
    } catch (e) {
      warnings.push({ file: 'js/plugins.js', message: errorText(e) });
    }
  }

  const units = mergeUnits(raw);
  await writeJsonFile(path.join(projectDir, UNITS_FILE), units);
  return { units, warnings };
}

/** Reads units.json written by extractAll. */
export async function loadUnits(projectDir: string): Promise<TextUnit[]> {
  const file = path.join(projectDir, UNITS_FILE);
  if (!existsSync(file)) throw new Error('텍스트 목록(units.json)이 없습니다. 먼저 가져오기를 하세요');
  return (await readJsonFile(file)) as TextUnit[];
}
