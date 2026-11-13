import { existsSync } from 'node:fs';
import path from 'node:path';
import type { TextUnit } from '../types.js';
import { readJsonFile, writeJsonFile } from '../util/json.js';
import { keepPieces } from './keys.js';
import type { Decision, Decisions } from './types.js';

export const DECISIONS_FILE = 'decisions.json';

export async function loadDecisions(projectDir: string): Promise<Decisions> {
  const file = path.join(projectDir, DECISIONS_FILE);
  if (!existsSync(file)) return {};
  const d = await readJsonFile(file);
  return d && typeof d === 'object' && !Array.isArray(d) ? (d as Decisions) : {};
}

export async function saveDecisions(projectDir: string, d: Decisions): Promise<void> {
  await writeJsonFile(path.join(projectDir, DECISIONS_FILE), d);
}

/** The unit's own decision ('unit:<id>') if there is one, else its group's. Suggestions included. */
export function decisionFor(unit: TextUnit, d: Decisions): Decision | null {
  return d[`unit:${unit.id}`] ?? (unit.decisionKey !== undefined ? d[unit.decisionKey] : undefined) ?? null;
}

/** The confirmed decision that applies to the unit (a unit's own one first), or null. */
export function confirmedDecisionFor(unit: TextUnit, d: Decisions): Decision | null {
  const own = d[`unit:${unit.id}`];
  if (own?.status === 'confirmed') return own;
  const group = unit.decisionKey !== undefined ? d[unit.decisionKey] : undefined;
  return group?.status === 'confirmed' ? group : null;
}

/** Whether the unit goes into translation: a normal unit, or one confirmed as translated with something left to translate. */
export function isTranslatable(unit: TextUnit, d: Decisions): boolean {
  if (!unit.needsDecision) return true;
  const dec = confirmedDecisionFor(unit, d);
  return !!dec && dec.translate && keepPieces(unit.source, dec.keep) !== null;
}
