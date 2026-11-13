import type { UnitKind } from '../types.js';

/** Which part of a value stays as it is. */
export type KeepRule =
  | { mode: 'whole' }                                   // the whole value is display text
  | { mode: 'args'; from: number; dropLast: number }    // MV command: only the space-separated pieces [from, end - dropLast) are translated
  | { mode: 'spans' };                                  // only the Japanese spans are translated, the rest stays

export interface Decision { translate: boolean; keep: KeepRule; status: 'suggested' | 'confirmed'; reason?: string; by: 'user' | 'claude' | 'meta' }

export interface DecisionGroup {
  key: string; label: string; kind: UnitKind; count: number;
  samples: string[];                 // up to 5 distinct sources
  hints: { fileNames: number; metaType?: string; metaText?: string; metaDesc?: string };  // fileNames = samples equal to a game file name
  decision: Decision | null;
}

/** Keys are decision keys or 'unit:<id>' (a single unit; wins over its group). */
export type Decisions = Record<string, Decision>;

/** What a plugin's header comment says about one parameter or argument. */
export interface ParamMeta { type?: string; text?: string; desc?: string }

/** A plugin's header comment (src/core/extract/pluginMeta.ts). structs: '~struct~' blocks, struct name -> field -> meta. */
export interface PluginMeta {
  params: Record<string, ParamMeta>;
  commands: Record<string, { text?: string; desc?: string; args: Record<string, ParamMeta> }>;
  structs?: Record<string, Record<string, ParamMeta>>;
}
