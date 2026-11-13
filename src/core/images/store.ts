import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { readJsonFile, writeJsonFile } from '../util/json.js';
import type { ImageEntry, ImageRecipe, ImagesFile, Rect, Region } from './types.js';

export const IMAGES_FILE = 'images.json';
export const MIN_TEXT_SIZE = 6;
export const MAX_TEXT_SIZE = 512;
const COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export async function loadImages(projectDir: string): Promise<ImagesFile> {
  const file = path.join(projectDir, IMAGES_FILE);
  if (!existsSync(file)) return { defaultFontPath: null, recipes: {} };
  const raw = (await readJsonFile(file)) as Partial<ImagesFile> | null;
  const out: ImagesFile = {
    defaultFontPath: typeof raw?.defaultFontPath === 'string' ? raw.defaultFontPath : null,
    recipes: raw?.recipes && typeof raw.recipes === 'object' ? raw.recipes : {},
  };
  if (Array.isArray(raw?.folders)) out.folders = raw.folders.filter((f): f is string => typeof f === 'string');
  return out;
}

export async function saveImages(projectDir: string, f: ImagesFile): Promise<void> {
  await writeJsonFile(path.join(projectDir, IMAGES_FILE), f);
}

function color(v: unknown, fallback: string): string {
  if (v === undefined || v === null) return fallback;
  if (typeof v !== 'string' || !COLOR.test(v)) throw new Error(`색 값이 올바르지 않습니다: ${String(v)}`);
  return v;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** Cuts the rect to the picture (whole pixels). */
function clipRect(r: Rect, image: { width: number; height: number }): Rect {
  const x0 = Math.max(0, Math.round(num(r.x, 0)));
  const y0 = Math.max(0, Math.round(num(r.y, 0)));
  const x1 = Math.min(image.width, Math.round(num(r.x, 0) + num(r.w, 0)));
  const y1 = Math.min(image.height, Math.round(num(r.y, 0) + num(r.h, 0)));
  if (x1 - x0 < 1 || y1 - y0 < 1) throw new Error('영역이 그림 밖에 있습니다');
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Fills in defaults, makes an id, cuts the rect to the picture and checks colours and size. */
export function normalizeRegion(r: Partial<Region> & { rect: Rect }, image: { width: number; height: number }): Region {
  const erase = r.erase === 'none' || r.erase === 'fill' || r.erase === 'sample' ? r.erase : 'sample';
  const out: Region = {
    id: typeof r.id === 'string' && r.id ? r.id : randomBytes(6).toString('hex'),
    rect: clipRect(r.rect, image),
    erase,
    text: typeof r.text === 'string' ? r.text.replace(/\r\n?/g, '\n') : '',
    fontPath: typeof r.fontPath === 'string' && r.fontPath ? r.fontPath : null,
    size: Math.min(MAX_TEXT_SIZE, Math.max(MIN_TEXT_SIZE, num(r.size, 24))),
    color: color(r.color, '#ffffff'),
    align: r.align === 'left' || r.align === 'right' ? r.align : 'center',
    valign: r.valign === 'top' || r.valign === 'bottom' ? r.valign : 'middle',
    lineHeight: Math.min(5, Math.max(0.5, num(r.lineHeight, 1.25))),
    bold: r.bold === true,
    stroke: r.stroke ? { color: color(r.stroke.color, '#000000'), width: Math.max(0, num(r.stroke.width, 2)) } : null,
    shadow: r.shadow
      ? { color: color(r.shadow.color, '#000000'), dx: num(r.shadow.dx, 2), dy: num(r.shadow.dy, 2), blur: Math.max(0, num(r.shadow.blur, 0)) }
      : null,
  };
  if (erase === 'fill') out.fillColor = color(r.fillColor, '#000000');
  else if (r.fillColor !== undefined) out.fillColor = color(r.fillColor, '#000000');
  if (typeof r.source === 'string' && r.source !== '') out.source = r.source;
  return out;
}

/**
 * Why a recipe cannot be rendered now: the picture is gone or changed since the recipe was written,
 * or a region with text has no font file. undefined when it is fine.
 */
export function recipeProblem(
  recipe: ImageRecipe,
  entry: { hash: string } | undefined,
  fontExists: (path: string) => boolean,
  defaultFontPath: string | null,
): ImageEntry['problem'] | undefined {
  if (!entry || entry.hash !== recipe.baseHash) return 'base-changed';
  if (recipe.status === 'manual') return undefined;
  for (const r of recipe.regions) {
    if (r.text.trim() === '') continue;
    const font = r.fontPath ?? defaultFontPath;
    if (!font || !fontExists(font)) return 'font-missing';
  }
  return undefined;
}

/** Whether the picture goes into the patch: a finished recipe without problems, or a hand-fixed PNG. */
export function isBuildable(recipe: ImageRecipe, problem: ImageEntry['problem'] | undefined): boolean {
  if (recipe.status === 'done') return problem === undefined;
  // A hand-fixed picture made from an older original waits for the user's confirmation too.
  if (recipe.status === 'manual') return !!recipe.manualFile && problem !== 'base-changed';
  return false;
}
