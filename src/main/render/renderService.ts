import { createHash } from 'node:crypto';
import type { Region } from '../../core/images/types.js';

/** Draws one picture from its recipe. fonts: font path → file bytes. */
export interface RenderJob { base: Uint8Array; regions: Region[]; fonts: Record<string, Uint8Array>; defaultFontPath: string | null }
/** A contact sheet: cells in a grid, each picture shrunk into its cell with its number and label below. */
export interface SheetJob { cells: { label: string; png: Uint8Array }[]; columns: number; cellSize: number }

import type { RenderReply, RenderRequest } from '../../shared/renderProtocol.js';
export type { RenderReply, RenderRequest };

/** The hidden worker window as the service sees it (a BrowserWindow wrapper in the app, a fake in tests). */
export interface RenderWindowLike {
  send(req: RenderRequest): void;
  on(event: 'done', listener: (r: RenderReply) => void): unknown;
  on(event: 'closed', listener: () => void): unknown;
  destroy(): void;
}

type Payload = DistributiveOmit<RenderRequest, 'id'>;
type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;

const DEFAULT_TIMEOUT = 30_000;
const NOT_RENDERED = '그림을 찍지 못했습니다';

class WindowLost extends Error {}

interface Live { win: RenderWindowLike; sentFonts: Set<string>; pending: Map<number, (r: RenderReply | Error) => void> }

/**
 * Runs drawing jobs in a hidden Electron window, one at a time. A window that dies or stops answering
 * is replaced and the job is sent once more; a second failure fails only that job.
 */
export class RenderService {
  private live: Live | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private nextId = 1;
  private readonly timeoutMs: number;
  private disposed = false;

  constructor(private readonly o: { createWindow: () => RenderWindowLike; timeoutMs?: number }) {
    this.timeoutMs = o.timeoutMs ?? DEFAULT_TIMEOUT;
  }

  render(job: RenderJob): Promise<Uint8Array> {
    return this.enqueue(job);
  }

  sheet(job: SheetJob): Promise<Uint8Array> {
    return this.enqueue({ kind: 'sheet', cells: job.cells, columns: job.columns, cellSize: job.cellSize });
  }

  /** Shrinks a PNG so its longer side is at most maxSide (never enlarges). */
  thumbnail(png: Uint8Array, maxSide: number): Promise<Uint8Array> {
    return this.enqueue({ kind: 'thumbnail', png, maxSide });
  }

  dispose(): void {
    this.disposed = true;
    this.drop(new WindowLost('작업 창을 닫았습니다'));
  }

  private enqueue(job: RenderJob | Payload): Promise<Uint8Array> {
    const run = this.chain.then(() => this.runWithRetry(job));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async runWithRetry(job: RenderJob | Payload): Promise<Uint8Array> {
    if (this.disposed) throw new Error(`${NOT_RENDERED}: 작업 창을 닫았습니다`);
    let last = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.runOnce(job);
      } catch (e) {
        if (!(e instanceof WindowLost)) throw e;
        last = e.message;
        this.drop(e);
      }
    }
    throw new Error(`${NOT_RENDERED}: ${last}`);
  }

  private window(): Live {
    if (this.live) return this.live;
    const win = this.o.createWindow();
    const live: Live = { win, sentFonts: new Set(), pending: new Map() };
    win.on('done', (r) => {
      const settle = live.pending.get(r.id);
      if (settle) {
        live.pending.delete(r.id);
        settle(r);
      }
    });
    win.on('closed', () => {
      if (this.live === live) this.drop(new WindowLost('작업 창이 닫혔습니다'));
    });
    this.live = live;
    return live;
  }

  /** Forgets the window (destroying it) and fails whatever it was doing with err. */
  private drop(err: Error): void {
    const live = this.live;
    if (!live) return;
    this.live = null;
    for (const settle of live.pending.values()) settle(err);
    live.pending.clear();
    try {
      live.win.destroy();
    } catch {
      // already gone
    }
  }

  private request(live: Live, job: RenderJob | Payload): Payload {
    if ('kind' in job) return job;
    const fontKeys: Record<string, string> = {};
    const fonts: Record<string, Uint8Array> = {};
    for (const [p, bytes] of Object.entries(job.fonts)) {
      const key = createHash('sha1').update(bytes).digest('hex');
      fontKeys[p] = key;
      if (!live.sentFonts.has(key)) fonts[key] = bytes;
    }
    return { kind: 'render', base: job.base, regions: job.regions, defaultFontPath: job.defaultFontPath, fontKeys, fonts };
  }

  private runOnce(job: RenderJob | Payload): Promise<Uint8Array> {
    const live = this.window();
    const id = this.nextId++;
    const req = { ...this.request(live, job), id } as RenderRequest;
    return new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        live.pending.delete(id);
        reject(new WindowLost('작업 창이 응답하지 않았습니다'));
      }, this.timeoutMs);
      live.pending.set(id, (r) => {
        clearTimeout(timer);
        if (r instanceof Error) return reject(r);
        if (r.ok) {
          if (req.kind === 'render') for (const k of Object.keys(req.fonts)) live.sentFonts.add(k);
          return resolve(r.png instanceof Uint8Array ? r.png : new Uint8Array(r.png));
        }
        reject(new Error(`${NOT_RENDERED}: ${r.error}`));
      });
      try {
        live.win.send(req);
      } catch (e) {
        live.pending.delete(id);
        clearTimeout(timer);
        reject(new WindowLost(e instanceof Error ? e.message : String(e)));
      }
    });
  }
}
