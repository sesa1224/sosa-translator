// Messages between the main process and the hidden render worker window (plan 7).
import type { Region } from '../core/images/types.js';

/**
 * What the worker window gets. Font bytes are sent once per window (fonts: key → bytes); fontKeys
 * maps the job's font paths to those keys.
 */
export type RenderRequest =
  | { id: number; kind: 'render'; base: Uint8Array; regions: Region[]; defaultFontPath: string | null; fontKeys: Record<string, string>; fonts: Record<string, Uint8Array> }
  | { id: number; kind: 'sheet'; cells: { label: string; png: Uint8Array }[]; columns: number; cellSize: number; fontKeys?: undefined; fonts?: undefined }
  | { id: number; kind: 'thumbnail'; png: Uint8Array; maxSide: number; fontKeys?: undefined; fonts?: undefined };
export type RenderReply = { id: number; ok: true; png: Uint8Array } | { id: number; ok: false; error: string };

/** What the render preload gives the worker page. */
export interface RenderBridge {
  onJob(cb: (req: RenderRequest) => void): void;
  done(reply: RenderReply): void;
}
