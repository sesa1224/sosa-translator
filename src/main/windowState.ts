// Where the main window opens: the size, place and maximized state it had when it was last closed. It is kept
// apart from settings.json because the settings screen rewrites that file whole with only the AppSettings fields.
import { readFileSync, renameSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

export interface Rect { x: number; y: number; width: number; height: number }
export interface WindowState extends Rect { maximized: boolean }

const STATE_FILE = 'window.json';
const FIRST_SIZE = { width: 1600, height: 1000 };
/** The share of the work area a first window may take, so it never opens edge to edge on a small laptop screen. */
const FIRST_SHARE = 0.9;
/** How much of the title bar must stay on a screen for the window to be dragged back by hand. */
const TITLE_BAR = 40;
const GRAB_WIDTH = 200;

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

function grabbable(r: Rect, work: Rect): boolean {
  const bar: Rect = { x: r.x, y: r.y, width: r.width, height: TITLE_BAR };
  const inside = r.y >= work.y && r.y + TITLE_BAR <= work.y + work.height;
  return inside && overlap(bar, work) >= Math.min(GRAB_WIDTH, r.width) * TITLE_BAR;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(v, hi));

/**
 * Where to open the window, from what was saved (null on the first run) and the screens' work areas now. A
 * window whose title bar can no longer be reached (its monitor was unplugged, or it sits above the top edge) is
 * pulled onto the screen it overlaps most, else the primary one; a size bigger than that screen shrinks to fit.
 */
export function placeWindow(saved: WindowState | null, workAreas: Rect[], primary: Rect): WindowState {
  if (!saved) {
    const width = Math.min(FIRST_SIZE.width, Math.floor(primary.width * FIRST_SHARE));
    const height = Math.min(FIRST_SIZE.height, Math.floor(primary.height * FIRST_SHARE));
    return {
      x: primary.x + Math.floor((primary.width - width) / 2),
      y: primary.y + Math.floor((primary.height - height) / 2),
      width, height, maximized: false,
    };
  }
  let home = primary;
  let best = 0;
  for (const w of workAreas) {
    const o = overlap(saved, w);
    if (o > best) { best = o; home = w; }
  }
  const width = Math.min(saved.width, home.width);
  const height = Math.min(saved.height, home.height);
  const r = { x: saved.x, y: saved.y, width, height };
  if (workAreas.some((w) => grabbable(r, w))) return { ...r, maximized: saved.maximized };
  return {
    x: clamp(r.x, home.x, home.x + home.width - width),
    y: clamp(r.y, home.y, home.y + home.height - height),
    width, height, maximized: saved.maximized,
  };
}

function isState(v: unknown): v is WindowState {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  const n = (k: string) => typeof o[k] === 'number' && Number.isFinite(o[k]);
  return n('x') && n('y') && n('width') && n('height') && (o.width as number) > 0 && (o.height as number) > 0 && typeof o.maximized === 'boolean';
}

/** The saved state in <dir>/window.json, or null when there is none or it is unreadable. */
export async function loadWindowState(dir: string): Promise<WindowState | null> {
  const file = path.join(dir, STATE_FILE);
  if (!existsSync(file)) return null;
  try {
    let text = readFileSync(file, 'utf8');
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    const v: unknown = JSON.parse(text);
    if (!isState(v)) return null;
    return { x: v.x, y: v.y, width: v.width, height: v.height, maximized: v.maximized };
  } catch {
    return null;
  }
}

/**
 * Writes the window state once the window has been still for `delay` ms, so dragging an edge does not write the
 * file dozens of times a second. flush() writes at once (on close). Writes are synchronous so the last one is on
 * disk before the app quits.
 */
export class WindowStateSaver {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pending: WindowState | null = null;

  constructor(private readonly dir: string, private readonly delay = 500, private readonly onWrite?: (s: WindowState) => void) {}

  update(s: WindowState): void {
    this.pending = s;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delay);
  }

  flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const s = this.pending;
    if (!s) return;
    this.pending = null;
    try {
      mkdirSync(this.dir, { recursive: true });
      const file = path.join(this.dir, STATE_FILE);
      writeFileSync(`${file}.tmp`, JSON.stringify(s, null, 2) + '\n', 'utf8');
      renameSync(`${file}.tmp`, file);
    } catch {
      // Losing the window's place is not worth an error on quit.
    }
    this.onWrite?.(s);
  }
}
