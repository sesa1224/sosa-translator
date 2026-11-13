import type { Warning } from '../types.js';

/** One imported version of the game (an entry of ProjectMeta.versions). */
export interface VersionInfo { id: string; label: string; importedAt: string; gameDir: string }

/** An old and a new sentence taken for the same changed sentence. punctuationOnly: they differ only in spaces, line breaks and punctuation. */
export interface ChangedPair { oldId: string; newId: string; similarity: number; punctuationOnly: boolean }

/**
 * How the units of two versions relate. added and removed hold only units that were not paired.
 * moved: units whose id changed only because of where they sit (always empty now: see diffUnits).
 */
export interface UnitDiff { kept: string[]; added: string[]; removed: string[]; changed: ChangedPair[]; moved: { oldId: string; newId: string }[] }

/** What a game update did with one patch: still fits, moved to the new positions, or could not be placed. */
export interface PatchMove { id: string; title: string; result: 'unchanged' | 'moved' | 'conflict'; reason?: string }

/** The result of one game update, saved in updates/<version>.json and shown on the update result screen. */
export interface UpdateSummary {
  from: string; to: string; fromLabel: string; toLabel: string;
  kept: number; keptTranslated: number;
  added: number; changed: number; carried: number;           // carried = changed only in punctuation, old translation filled in
  removed: number; removedTranslated: number;
  patches: PatchMove[];
  images: { changed: string[]; added: number; removed: number };   // changed = pictures with a recipe whose original changed
  decisions: { newGroups: number };                          // new needs-decision groups without a decision
  warnings: Warning[];
}
