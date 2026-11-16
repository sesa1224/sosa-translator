// The action log (history.json): every change to the translation table, one entry per thing the user would call
// one action, kept across sessions so any one of them can be cancelled later. Kept free of node imports so the
// renderer can use the types.
import type { TranslationEntry } from '../types.js';

/** Who made a change (the same values as the app's change origin). */
export type ActionOrigin = 'user' | 'chat' | 'batch' | 'review' | 'external';
export interface ActionChange { unitId: string; before: TranslationEntry; after: TranslationEntry }
/** label: Korean, shown as is. undoneAt: when it was cancelled (it cannot be cancelled again). */
export interface ActionRecord { id: string; at: string; origin: ActionOrigin; label: string; changes: ActionChange[]; undoneAt?: string }
/** What the log screen lists: an action without its changes, which can be thousands of entries. */
export interface ActionSummary { id: string; at: string; origin: ActionOrigin; label: string; count: number; undoneAt?: string }
/** restored: lines put back; skipped: lines changed again since, left as they are. */
export interface CancelResult { restored: number; skipped: number }
