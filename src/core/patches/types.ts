import type { PathSeg } from '../types.js';

/** One RPG Maker event command. */
export interface EventCommand { code: number; indent: number; parameters: unknown[] }

/** An edit of an original command list. Numbers are positions in the original list, never in an edited one. */
export type ListOp =
  | { op: 'insert'; after: number; commands: EventCommand[] }   // after: original index; -1 = at the front
  | { op: 'delete'; at: number }                                  // at: original index
  | { op: 'replace'; at: number; commands: EventCommand[] };

export type PatchBody =
  | { kind: 'event'; file: string; listPath: PathSeg[]; baseHash: string; ops: ListOp[] }
  | { kind: 'json'; file: string; path: PathSeg[]; baseValue: unknown; value: unknown }
  // A new plugin file, registered at the end of js/plugins.js.
  | { kind: 'plugin'; name: string; js: string; parameters: Record<string, string>; description: string }
  | { kind: 'font'; fontPath: string; subset: boolean };

export interface Patch {
  id: string; title: string; note: string; enabled: boolean; originalBug: boolean;
  createdBy: 'user' | 'claude'; createdAt: string; body: PatchBody;
}

export type PatchState = 'applied' | 'disabled' | 'conflict';
export interface PatchStatus { id: string; state: PatchState; reason?: string }
