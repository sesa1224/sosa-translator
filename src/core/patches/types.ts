import type { PathSeg } from '../types.js';

/** One RPG Maker event command. */
export interface EventCommand { code: number; indent: number; parameters: unknown[] }

/** An edit of an original command list. Numbers are positions in the original list, never in an edited one. */
export type ListOp =
  | { op: 'insert'; after: number; commands: EventCommand[] }   // after: original index; -1 = at the front
  | { op: 'delete'; at: number }                                  // at: original index
  | { op: 'replace'; at: number; commands: EventCommand[] };

/** What a patch changes. event: edits of one command list; json: one value in a data file. */
export type PatchBody =
  | { kind: 'event'; file: string; listPath: PathSeg[]; baseHash: string; ops: ListOp[] }
  | { kind: 'json'; file: string; path: PathSeg[]; baseValue: unknown; value: unknown }
  // A new plugin file, registered at the end of js/plugins.js.
  | { kind: 'plugin'; name: string; js: string; parameters: Record<string, string>; description: string }
  | { kind: 'font'; fontPath: string; subset: boolean }
  // The bundled Korean particle plugin (core/patches/josa.ts); its JS is not stored so app updates reach it.
  | { kind: 'josa' };

export interface Patch {
  id: string; title: string; note: string; enabled: boolean; originalBug: boolean;
  createdBy: 'user' | 'claude'; createdAt: string; body: PatchBody;
}

/** conflict: the original no longer matches what the patch recorded, so it is not applied. */
export type PatchState = 'applied' | 'disabled' | 'conflict';
export interface PatchStatus { id: string; state: PatchState; reason?: string }
