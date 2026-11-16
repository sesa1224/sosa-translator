// The action log (history.json): every change to the translation table, one entry per thing the user would call
// one action, kept across sessions so any one of them can be cancelled later. Kept free of node imports so the
// renderer can use the types.
import type { TranslationEntry, TranslationStatus } from '../types.js';

/** Who made a change (the same values as the app's change origin). */
export type ActionOrigin = 'user' | 'chat' | 'batch' | 'review' | 'external';
export interface ActionChange { unitId: string; before: TranslationEntry; after: TranslationEntry }
/** label: Korean, shown as is. undoneAt: when it was cancelled (it cannot be cancelled again). */
export interface ActionRecord { id: string; at: string; origin: ActionOrigin; label: string; changes: ActionChange[]; undoneAt?: string }
/**
 * The first changed line, so the log says what changed without opening the action. Text is cut to one short line.
 * source null: the line is gone from the project (extracted again). cleared: the action removed the translation.
 * status: only the status changed (the translation stayed). more: the other lines of the action.
 */
export interface ActionPreview {
  source: string | null; target: string | null; more: number;
  cleared?: true; status?: { before: TranslationStatus; after: TranslationStatus };
}
/** What the log screen lists: an action without its changes, which can be thousands of entries. */
export interface ActionSummary { id: string; at: string; origin: ActionOrigin; label: string; count: number; undoneAt?: string; preview?: ActionPreview }
/** A translation and status, before or after an action. */
export interface ActionSide { target: string | null; status: TranslationStatus }
/** One changed line of an action, as the opened log entry shows it. exists false: the line is gone (source null, location ''). */
export interface ActionLine { unitId: string; exists: boolean; source: string | null; location: string; before: ActionSide; after: ActionSide }
/** A page of an action's changed lines (an action can hold thousands); total is the whole count. */
export interface ActionDetail { id: string; total: number; offset: number; lines: ActionLine[] }
/** restored: lines put back; skipped: lines changed again since, left as they are. */
export interface CancelResult { restored: number; skipped: number }
