import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { encryptAsset } from '../core/engine/crypto.js';
import { checkGlossary } from '../core/glossary/match.js';
import { ImageCatalog, pngSize } from '../core/images/catalog.js';
import { fitInside, MAX_CLAUDE_SIDE } from '../core/images/sheet.js';
import { layoutRegionText } from '../core/images/layoutText.js';
import { LoadedFont } from './fonts/fontFile.js';
import { IMAGES_FILE, isBuildable, normalizeRegion, recipeProblem, saveImages } from '../core/images/store.js';
import type { ImageEntry, ImageRecipe, ImagesFile, ImageStatus, Rect, Region } from '../core/images/types.js';
import type { GameInfo } from '../core/types.js';
import type { ProjectService } from './projectService.js';
import { IMAGE_FOLDERS } from '../core/images/catalog.js';
import type { JobProgress } from '../shared/api.js';
import type { RenderService } from './render/renderService.js';

export const THUMB_SIDE = 256;
export const SHEET_PER_PAGE = 20;
export const SHEET_COLUMNS = 5;

type RegionInput = Partial<Region> & { rect: Rect };

export interface ImageService {
  on(event: 'changed', listener: (files: string[]) => void): this;
  off(event: 'changed', listener: (files: string[]) => void): this;
  emit(event: 'changed', files: string[]): boolean;
}

function sha1(data: Uint8Array | string): string {
  return createHash('sha1').update(data).digest('hex');
}

function readImagesFileSync(projectDir: string): ImagesFile {
  try {
    const file = path.join(projectDir, IMAGES_FILE);
    if (!existsSync(file)) return { defaultFontPath: null, recipes: {} };
    const raw = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, '')) as Partial<ImagesFile>;
    const out: ImagesFile = { defaultFontPath: typeof raw.defaultFontPath === 'string' ? raw.defaultFontPath : null, recipes: raw.recipes && typeof raw.recipes === 'object' ? raw.recipes : {} };
    if (Array.isArray(raw.folders)) out.folders = raw.folders.filter((f): f is string => typeof f === 'string');
    return out;
  } catch {
    return { defaultFontPath: null, recipes: {} };
  }
}

/**
 * Pictures of the open project and their recipes (images.json). Renders through the hidden worker
 * window and keeps every result under images/ (rendered/, thumbs/, manual/), never in the game folder.
 */
export class ImageService extends EventEmitter {
  private data: ImagesFile;
  private catalog: ImageCatalog | null;
  private entries = new Map<string, ImageEntry>();
  private listed = false;
  private readonly failed = new Map<string, string>();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly fontExists: (p: string) => boolean;
  private readonly readFont: (p: string) => Promise<Uint8Array>;
  /** Font files the chat may name (the font list the user sees); others are dropped. Set by the IPC layer. */
  knownFonts: () => string[] = () => [];
  private readonly loadedFonts = new Map<string, Promise<LoadedFont | null>>();

  constructor(private readonly o: {
    svc: ProjectService; game: GameInfo | null; render: Pick<RenderService, 'render' | 'sheet' | 'thumbnail'>;
    fontExists?: (p: string) => boolean; readFont?: (p: string) => Promise<Uint8Array>;
    /** Folders to look in (default IMAGE_FOLDERS). */
    folders?: string[];
  }) {
    super();
    this.data = readImagesFileSync(o.svc.projectDir);
    this.catalog = o.game ? new ImageCatalog(o.svc.projectDir, o.game, { folders: o.folders ?? this.data.folders }) : null;
    this.fontExists = o.fontExists ?? ((p) => existsSync(p));
    this.readFont = o.readFont ?? (async (p) => new Uint8Array(await readFile(p)));
    attachImageService(o.svc, this);
  }

  /** Overflow of each region of a picture's recipe, measured with its font. */
  async overflow(file: string): Promise<Record<string, { overflowX: boolean; overflowY: boolean }>> {
    const r = this.data.recipes[file];
    if (!r) return {};
    return regionOverflow(r.regions, this.data.defaultFontPath, (p) => {
      const key = this.fontStamp(p);
      let f = this.loadedFonts.get(key);
      if (!f) {
        f = this.fontExists(p) ? LoadedFont.load(p).catch(() => null) : Promise.resolve(null);
        this.loadedFonts.set(key, f);
      }
      return f;
    });
  }

  private get dir(): string {
    return path.join(this.o.svc.projectDir, 'images');
  }

  get defaultFontPath(): string | null {
    return this.data.defaultFontPath;
  }

  private problemOf(recipe: ImageRecipe | undefined, entry: ImageEntry | undefined): ImageEntry['problem'] | undefined {
    if (!recipe) return undefined;
    return recipeProblem(recipe, entry, this.fontExists, this.data.defaultFontPath) ?? (this.failed.has(recipe.file) ? 'render-failed' : undefined);
  }

  private decorate(e: ImageEntry): ImageEntry {
    const recipe = this.data.recipes[e.file];
    const out: ImageEntry = { ...e, status: recipe?.status ?? 'none' };
    const problem = this.problemOf(recipe, e);
    if (problem) out.problem = problem;
    else delete out.problem;
    return out;
  }

  /** Pictures with their recipe status and problems. Empty when the game folder is gone. */
  async list(): Promise<ImageEntry[]> {
    if (!this.catalog) return [];
    const raw = await this.catalog.list();
    this.entries = new Map(raw.map((e) => [e.file, e]));
    this.listed = true;
    return raw.map((e) => this.decorate(e));
  }

  /** One picture's entry (decorated), or undefined. */
  async entry(file: string): Promise<ImageEntry | undefined> {
    if (!this.listed) await this.list();
    const e = this.entries.get(file);
    return e ? this.decorate(e) : undefined;
  }

  /** Last error message of a picture that failed to render. */
  failure(file: string): string | undefined {
    return this.failed.get(file);
  }

  recipe(file: string): ImageRecipe | null {
    const r = this.data.recipes[file];
    return r ? structuredClone(r) : null;
  }

  async original(file: string): Promise<Uint8Array> {
    if (!this.catalog) throw new Error('게임 폴더를 찾을 수 없습니다');
    return this.catalog.bytes(file);
  }

  /** Font files a recipe draws with (only regions with text need one). */
  private fontPaths(recipe: ImageRecipe): string[] {
    const set = new Set<string>();
    for (const r of recipe.regions) {
      if (r.text.trim() === '') continue;
      const p = r.fontPath ?? this.data.defaultFontPath;
      if (p) set.add(p);
    }
    return [...set];
  }

  private fontStamp(p: string): string {
    try {
      const st = statSync(p);
      return `${p}|${st.size}|${st.mtimeMs}`;
    } catch {
      return `${p}|missing`;
    }
  }

  /** Cache key: original picture + recipe + the fonts it uses (their size and time, so a replaced font file renders again). */
  private renderKey(recipe: ImageRecipe, entry: ImageEntry): string {
    return sha1(JSON.stringify({ base: entry.hash, regions: recipe.regions, def: this.data.defaultFontPath, fonts: this.fontPaths(recipe).map((p) => this.fontStamp(p)) }));
  }

  /**
   * The picture drawn from its recipe (cached in images/rendered/), or the hand-fixed file for 'manual'.
   * null when there is no recipe, the picture is gone, or a font is missing.
   */
  async rendered(file: string): Promise<Uint8Array | null> {
    const recipe = this.data.recipes[file];
    if (!recipe) return null;
    if (recipe.status === 'manual' && recipe.manualFile) return new Uint8Array(await readFile(path.join(this.o.svc.projectDir, ...recipe.manualFile.split('/'))));
    const entry = await this.entry(file);
    if (!entry) return null;
    const problem = recipeProblem(recipe, entry, this.fontExists, this.data.defaultFontPath);
    if (problem === 'font-missing') return null;
    const key = this.renderKey(recipe, entry);
    const cached = path.join(this.dir, 'rendered', `${key}.png`);
    if (existsSync(cached)) return new Uint8Array(await readFile(cached));
    const fonts: Record<string, Uint8Array> = {};
    for (const p of this.fontPaths(recipe)) fonts[p] = await this.readFont(p);
    let png: Uint8Array;
    try {
      png = await this.o.render.render({ base: await this.original(file), regions: recipe.regions, fonts, defaultFontPath: this.data.defaultFontPath });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const had = this.failed.get(file);
      this.failed.set(file, msg);
      if (had !== msg) this.emit('changed', [file]);
      throw e;
    }
    await mkdir(path.dirname(cached), { recursive: true });
    await writeFile(cached, png);
    if (this.failed.delete(file)) this.emit('changed', [file]);
    return png;
  }

  /** A small copy (longer side 256), cached in images/thumbs/. 'rendered' falls back to the original when there is nothing rendered. */
  async thumbnail(file: string, which: 'original' | 'rendered'): Promise<Uint8Array> {
    const entry = await this.entry(file);
    if (!entry) throw new Error(`없는 그림입니다: ${file}`);
    const recipe = this.data.recipes[file];
    let name = `o-${entry.hash}`;
    if (which === 'rendered' && recipe) {
      if (recipe.status === 'manual' && recipe.manualFile) name = `m-${sha1(this.fontStamp(path.join(this.o.svc.projectDir, recipe.manualFile)))}`;
      else if (recipeProblem(recipe, entry, this.fontExists, this.data.defaultFontPath) !== 'font-missing') name = `r-${this.renderKey(recipe, entry)}`;
    }
    const cached = path.join(this.dir, 'thumbs', `${name}.png`);
    if (existsSync(cached)) return new Uint8Array(await readFile(cached));
    let png: Uint8Array | null = null;
    if (!name.startsWith('o-')) {
      try {
        png = await this.rendered(file);
      } catch {
        // a failed render shows the original; the problem is reported on the entry
        return this.thumbnail(file, 'original');
      }
    }
    const thumb = await this.o.render.thumbnail(png ?? (await this.original(file)), THUMB_SIDE);
    await mkdir(path.dirname(cached), { recursive: true });
    await writeFile(cached, thumb);
    return thumb;
  }

  private write<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async save(changed: string[]): Promise<void> {
    await saveImages(this.o.svc.projectDir, this.data);
    if (changed.length > 0) this.emit('changed', changed);
  }

  private async requireEntry(file: string): Promise<ImageEntry> {
    if (!this.listed || !this.entries.has(file)) await this.list();
    const e = this.entries.get(file);
    if (!e) throw new Error(`없는 그림입니다: ${file}`);
    return e;
  }

  /** One-line glossary note for regions whose source holds a term the translation does not use. */
  private glossaryNote(regions: Region[]): string | undefined {
    const terms = this.o.svc.glossary().terms;
    const notes = regions.flatMap((r) => (r.source ? checkGlossary(r.source, r.text, terms).map((i) => i.message) : []));
    return notes.length > 0 ? [...new Set(notes)].join(' / ') : undefined;
  }

  /**
   * Cleans the regions and saves the recipe. baseHash becomes the current original; the status stays
   * ('todo' for a new recipe). by: who wrote it (the chat or the user), for the record only.
   */
  setRecipe(file: string, regions: RegionInput[], _by: 'user' | 'claude'): Promise<ImageRecipe> {
    return this.write(async () => {
      const entry = await this.requireEntry(file);
      const clean = regions.map((r) => normalizeRegion(r, entry));
      const prev = this.data.recipes[file];
      const next: ImageRecipe = { file, baseHash: entry.hash, regions: clean, status: prev?.status ?? 'todo' };
      if (prev?.manualFile) next.manualFile = prev.manualFile;
      const note = this.glossaryNote(clean);
      if (note) next.note = note;
      this.data.recipes[file] = next;
      this.failed.delete(file);
      await this.save([file]);
      return structuredClone(next);
    });
  }

  private async ensureRecipe(file: string): Promise<ImageRecipe> {
    const had = this.data.recipes[file];
    if (had) return had;
    const entry = await this.requireEntry(file);
    const r: ImageRecipe = { file, baseHash: entry.hash, regions: [], status: 'todo' };
    this.data.recipes[file] = r;
    return r;
  }

  setStatus(file: string, status: ImageStatus): Promise<void> {
    return this.write(async () => {
      const r = await this.ensureRecipe(file);
      r.status = status === 'manual' && !r.manualFile ? r.status : status;
      await this.save([file]);
    });
  }

  /** Uses a PNG the user fixed by hand (copied into images/manual/), or stops using it (null). */
  setManual(file: string, pngPath: string | null): Promise<void> {
    return this.write(async () => {
      const r = await this.ensureRecipe(file);
      if (pngPath === null) {
        if (r.manualFile) await rm(path.join(this.o.svc.projectDir, ...r.manualFile.split('/')), { force: true });
        delete r.manualFile;
        if (r.status === 'manual') r.status = 'todo';
        await this.save([file]);
        return;
      }
      const entry = await this.requireEntry(file);
      const bytes = new Uint8Array(await readFile(pngPath));
      let size: { width: number; height: number };
      try {
        size = pngSize(bytes);
      } catch {
        throw new Error('PNG 파일이 아닙니다');
      }
      if (size.width !== entry.width || size.height !== entry.height) throw new Error(`직접 고친 그림의 크기가 원본과 달라요(원본 ${entry.width}x${entry.height})`);
      const rel = `images/manual/${file.replace(/[\\/]/g, '__')}`;
      const abs = path.join(this.o.svc.projectDir, ...rel.split('/'));
      await mkdir(path.dirname(abs), { recursive: true });
      await copyFile(pngPath, abs);
      r.manualFile = rel;
      r.status = 'manual';
      // The hand-fixed file was made from the current original.
      r.baseHash = entry.hash;
      await this.save([file]);
    });
  }

  /** The user checked a recipe against a changed original: it now belongs to the current one. */
  acceptBase(file: string): Promise<void> {
    return this.write(async () => {
      const r = this.data.recipes[file];
      if (!r) return;
      const entry = await this.requireEntry(file);
      r.baseHash = entry.hash;
      await this.save([file]);
    });
  }

  setDefaultFont(p: string | null): Promise<void> {
    return this.write(async () => {
      this.data.defaultFontPath = p;
      // Every recipe that uses the default font may look different (or work again) now.
      await this.save(Object.keys(this.data.recipes));
    });
  }

  /** Folders looked in: the user's choice, or IMAGE_FOLDERS. */
  folders(): string[] {
    return [...(this.o.folders ?? this.data.folders ?? IMAGE_FOLDERS)];
  }

  /** Changes the folders (null = back to the defaults); the next list() looks there. */
  setFolders(folders: string[] | null): Promise<void> {
    return this.write(async () => {
      const clean = folders ? [...new Set(folders.map((f) => f.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')).filter(Boolean))] : [];
      if (clean.length > 0) this.data.folders = clean;
      else delete this.data.folders;
      this.catalog = this.o.game ? new ImageCatalog(this.o.svc.projectDir, this.o.game, { folders: this.data.folders }) : null;
      this.listed = false;
      await saveImages(this.o.svc.projectDir, this.data);
    });
  }

  /** Files whose finished recipes "re-render all" draws again. */
  doneFiles(): string[] {
    return Object.values(this.data.recipes).filter((r) => r.status === 'done').map((r) => r.file);
  }

  /** Forgets every rendered picture so the next request draws it again. */
  async clearRendered(): Promise<void> {
    await rm(path.join(this.dir, 'rendered'), { recursive: true, force: true });
    for (const f of await this.listThumbs()) if (!path.basename(f).startsWith('o-')) await rm(f, { force: true });
    this.failed.clear();
  }

  private async listThumbs(): Promise<string[]> {
    const d = path.join(this.dir, 'thumbs');
    if (!existsSync(d)) return [];
    return (await readdir(d)).map((n) => path.join(d, n));
  }

  /** A contact sheet of one page of pictures (5 columns), with the numbers drawn on it. */
  async sheet(o: { folder?: string; status?: ImageEntry['status']; page: number; perPage?: number }): Promise<{
    png: Uint8Array; items: { n: number; file: string; width: number; height: number; status: string }[]; pages: number;
  }> {
    const per = Math.max(1, o.perPage ?? SHEET_PER_PAGE);
    const folder = o.folder ? o.folder.replace(/\/+$/, '') + '/' : '';
    const all = (await this.list()).filter((e) => (!folder || e.file.startsWith(folder)) && (!o.status || e.status === o.status));
    const pages = Math.max(1, Math.ceil(all.length / per));
    const page = Math.min(Math.max(1, Math.floor(o.page) || 1), pages);
    const slice = all.slice((page - 1) * per, page * per);
    const items = slice.map((e, i) => ({ n: i + 1, file: e.file, width: e.width, height: e.height, status: e.status }));
    if (slice.length === 0) return { png: new Uint8Array(0), items, pages };
    // Thumbnails keep the message to the worker small; the cells are no bigger anyway.
    const cells = [];
    for (const e of slice) cells.push({ label: e.file.replace(/^img\//, ''), png: await this.thumbnail(e.file, 'original') });
    const png = await this.o.render.sheet({ cells, columns: SHEET_COLUMNS, cellSize: THUMB_SIDE });
    return { png, items, pages };
  }

  /** One picture for Claude, longer side at most 1,568. scale: how much it was shrunk (recipes use original pixels). */
  async view(file: string, which: 'original' | 'rendered'): Promise<{ png: Uint8Array; scale: number }> {
    const entry = await this.requireEntry(file);
    const full = which === 'rendered' ? (await this.rendered(file)) ?? (await this.original(file)) : await this.original(file);
    const fit = fitInside(entry.width, entry.height, MAX_CLAUDE_SIDE);
    const png = await this.o.render.thumbnail(full, MAX_CLAUDE_SIDE);
    return { png, scale: fit.scale };
  }

  /**
   * Files for the patch: every buildable picture, rendered (or from the cache), re-encrypted when the
   * game's file was encrypted, under <contentPrefix><sourceFile>. Pictures that fail to render are skipped.
   */
  async buildFiles(contentPrefix: string): Promise<{ files: Map<string, Uint8Array>; skipped: { file: string; reason: string }[]; pictures: Record<string, string> }> {
    const files = new Map<string, Uint8Array>();
    const skipped: { file: string; reason: string }[] = [];
    // picture file → sha1 of the PNG that went in (the build notes compare these between builds)
    const pictures: Record<string, string> = {};
    if (!this.catalog) return { files, skipped, pictures };
    await this.list();
    for (const [file, recipe] of Object.entries(this.data.recipes)) {
      const entry = this.entries.get(file);
      if (!isBuildable(recipe, recipeProblem(recipe, entry, this.fontExists, this.data.defaultFontPath)) || !entry) continue;
      try {
        let png = await this.rendered(file);
        if (!png) throw new Error('그림을 찍지 못했습니다');
        pictures[file] = sha1(png);
        if (entry.encrypted) {
          if (!this.o.game?.encryptionKey) throw new Error('암호화 키가 없습니다');
          png = encryptAsset(png, this.o.game.encryptionKey);
        }
        files.set(contentPrefix + entry.sourceFile, png);
      } catch (e) {
        skipped.push({ file, reason: e instanceof Error ? e.message : String(e) });
      }
    }
    return { files, skipped, pictures };
  }
}

/** What the image contributor put into the last build of each service (the build notes reuse it instead of rendering twice). */
export const lastImageBuild = new WeakMap<ImageService, { number: number; projectDir: string; files: Map<string, Uint8Array>; skipped: { file: string; reason: string }[]; pictures: Record<string, string> }>();

/** Puts the finished pictures into every patch build of svc. */
export function registerImageContributor(svc: ProjectService, images: ImageService): void {
  svc.buildContributors.push(async (ctx) => {
    const r = await images.buildFiles(ctx.contentPrefix);
    lastImageBuild.set(images, { ...r, number: ctx.number, projectDir: ctx.projectDir });
    return r.files;
  });
}

/** The image service of each open project (the chat tools find it from the project). */
const services = new WeakMap<ProjectService, ImageService>();

export function attachImageService(svc: ProjectService, images: ImageService | null): void {
  if (images) services.set(svc, images);
  else services.delete(svc);
}

export function imageServiceOf(svc: ProjectService): ImageService | undefined {
  return services.get(svc);
}

/** Whether each region's text fits its area with the region's font (unknown fonts are left out). */
export async function regionOverflow(
  regions: Region[], defaultFontPath: string | null, load: (p: string) => Promise<{ measure: (t: string, size: number) => { width: number } } | null>,
): Promise<Record<string, { overflowX: boolean; overflowY: boolean }>> {
  const out: Record<string, { overflowX: boolean; overflowY: boolean }> = {};
  for (const r of regions) {
    if (r.text.trim() === '') continue;
    const p = r.fontPath ?? defaultFontPath;
    const font = p ? await load(p) : null;
    if (!font) continue;
    // Bold text is drawn a little wider than the font's advances; 5% keeps the warning on the safe side.
    const k = r.bold ? 1.05 : 1;
    const l = layoutRegionText(r, (t) => font.measure(t, r.size).width * k);
    out[r.id] = { overflowX: l.overflowX, overflowY: l.overflowY };
  }
  return out;
}

export class RerenderJob extends EventEmitter {
  private p: JobProgress = { kind: 'images', state: 'idle', done: 0, total: 0, label: '', usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 }, declined: 0, errors: 0 };
  private stopped = false;
  private paused = false;
  private queue: string[] | null = null;
  private loop: Promise<void> | null = null;

  constructor(private readonly images: ImageService) {
    super();
  }

  get progress(): JobProgress {
    return { ...this.p, usage: { ...this.p.usage } };
  }

  private update(patch: Partial<JobProgress>): void {
    this.p = { ...this.p, ...patch };
    this.emit('progress', this.progress);
  }

  start(): Promise<void> {
    if (this.loop) return this.loop;
    this.paused = false;
    this.loop = this.run().finally(() => { this.loop = null; });
    return this.loop;
  }

  private async run(): Promise<void> {
    if (!this.queue) {
      await this.images.clearRendered();
      this.queue = this.images.doneFiles();
      this.update({ total: this.queue.length });
    }
    this.update({ state: 'running', message: undefined });
    while (this.queue.length > 0) {
      if (this.stopped) return this.update({ state: 'stopped' });
      if (this.paused) return this.update({ state: 'paused' });
      const file = this.queue[0];
      this.update({ label: file });
      let failed = false;
      try {
        await this.images.rendered(file);
      } catch {
        failed = true;
      }
      this.queue.shift();
      this.update({ done: this.p.done + 1, errors: this.p.errors + (failed ? 1 : 0) });
    }
    this.update({ state: this.stopped ? 'stopped' : 'done', label: '' });
    this.images.emit('changed', this.images.doneFiles());
  }

  pause(): void {
    if (this.p.state === 'running') this.paused = true;
  }

  resume(): void {
    if (this.p.state === 'paused') void this.start();
  }

  stop(): void {
    this.stopped = true;
    if (!this.loop && this.p.state !== 'done') this.update({ state: 'stopped' });
  }
}
