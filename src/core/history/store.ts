// Reading, writing and trimming history.json, and the rule for when a logged change may be taken back.
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { locationLabel } from '../../shared/rows.js';
import type { TextUnit, TranslationEntry } from '../types.js';
import type { ActionChange, ActionDetail, ActionPreview, ActionRecord, ActionSummary } from './types.js';

export const HISTORY_FILE = 'history.json';
/** The newest actions kept; older ones drop off. */
export const HISTORY_LIMIT = 200;

export function newActionId(): string {
  return randomUUID();
}

const ORIGINS = new Set(['user', 'chat', 'batch', 'review', 'external']);

function readAction(v: any): ActionRecord | null {
  if (!v || typeof v !== 'object' || typeof v.id !== 'string' || typeof v.at !== 'string' || !ORIGINS.has(v.origin)
    || typeof v.label !== 'string' || !Array.isArray(v.changes)) return null;
  const changes = v.changes.filter((c: any) => c && typeof c.unitId === 'string' && c.before && typeof c.before === 'object' && c.after && typeof c.after === 'object');
  const a: ActionRecord = { id: v.id, at: v.at, origin: v.origin, label: v.label, changes };
  if (typeof v.undoneAt === 'string') a.undoneAt = v.undoneAt;
  return a;
}

/** Reads <projectDir>/history.json, oldest first. A missing or broken file gives an empty log (it is a convenience, not project data the build needs). */
export function loadHistory(projectDir: string): ActionRecord[] {
  const file = path.join(projectDir, HISTORY_FILE);
  if (!existsSync(file)) return [];
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')) as unknown;
    return Array.isArray(raw) ? raw.map(readAction).filter((a): a is ActionRecord => a !== null) : [];
  } catch {
    return [];
  }
}

/** Writes the log without indentation: a translate job alone can log thousands of before/after pairs. */
export async function saveHistory(projectDir: string, actions: ActionRecord[]): Promise<void> {
  const file = path.join(projectDir, HISTORY_FILE);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(actions) + '\n', 'utf8');
  await rename(tmp, file);
}

/** The newest HISTORY_LIMIT actions. */
export function trimHistory(actions: ActionRecord[]): ActionRecord[] {
  return actions.length > HISTORY_LIMIT ? actions.slice(actions.length - HISTORY_LIMIT) : actions;
}

/** Characters of source or translation the log list shows per line. */
export const PREVIEW_CHARS = 40;
/** Changed lines sent per request when an action is opened. */
export const DETAIL_LIMIT = 100;

/** Text on one line for the log list: line breaks become spaces, longer text is cut and ends in '…'. */
export function clipLine(text: string, max = PREVIEW_CHARS): string {
  const flat = text.replace(/[ \t]*\r?\n[ \t]*/g, ' ');
  const chars = [...flat];
  return chars.length > max ? `${chars.slice(0, max).join('')}…` : flat;
}

function previewOf(c: ActionChange, source: string | undefined, more: number): ActionPreview {
  const p: ActionPreview = { source: source === undefined ? null : clipLine(source), target: c.after.target === null ? null : clipLine(c.after.target), more };
  if (c.after.target === null && c.before.target !== null) p.cleared = true;
  else if (c.after.target === c.before.target && c.after.status !== c.before.status) p.status = { before: c.before.status, after: c.after.status };
  return p;
}

/**
 * The list entry of an action. sourceOf (the current units) fills the preview; it is worked out on reading, not
 * stored, so actions logged before previews existed get one too.
 */
export function summarize(a: ActionRecord, sourceOf?: (unitId: string) => string | undefined): ActionSummary {
  const s: ActionSummary = { id: a.id, at: a.at, origin: a.origin, label: a.label, count: a.changes.length };
  if (a.undoneAt !== undefined) s.undoneAt = a.undoneAt;
  const first = a.changes[0];
  if (first && sourceOf) s.preview = previewOf(first, sourceOf(first.unitId), a.changes.length - 1);
  return s;
}

/** A page of an action's changed lines, at most DETAIL_LIMIT; offset and limit are clamped rather than trusted. */
export function actionDetail(a: ActionRecord, unitOf: (unitId: string) => TextUnit | undefined, offset = 0, limit = DETAIL_LIMIT): ActionDetail {
  const start = Math.max(0, Math.floor(Number(offset) || 0));
  const n = Math.min(DETAIL_LIMIT, Math.max(1, Math.floor(Number(limit) || 0)));
  const lines = a.changes.slice(start, start + n).map((c) => {
    const u = unitOf(c.unitId);
    return {
      unitId: c.unitId, exists: u !== undefined, source: u?.source ?? null, location: u ? locationLabel(u) : '',
      before: { target: c.before.target, status: c.before.status }, after: { target: c.after.target, status: c.after.status },
    };
  });
  return { id: a.id, total: a.changes.length, offset: start, lines };
}

function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) if ((v as Record<string, unknown>)[k] !== undefined) out[k] = canonical((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

/**
 * Whether a line is still as the action left it, so cancelling it takes back only that action's work.
 * reviewedAt is left out: a later review that only looked at the line (no remark) does not change it.
 */
export function unchangedSince(current: TranslationEntry, after: TranslationEntry): boolean {
  const { reviewedAt: _a, ...c } = current;
  const { reviewedAt: _b, ...x } = after;
  return JSON.stringify(canonical(c)) === JSON.stringify(canonical(x));
}

/** Same entry, field order aside. */
export function sameEntry(a: TranslationEntry, b: TranslationEntry): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
