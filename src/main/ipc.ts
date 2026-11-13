import { existsSync } from 'node:fs';
import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { detectGame, openProject, originalDir, readJsonFile, type TextUnit, type TranslationStatus } from '../core/index.js';
import type * as core from '../core/index.js';
import type * as shared from '../shared/api.js';
import type {
  AppSettings, ChatEvent, ChatImage, InvokeChannel, JobProgress, ProjectChanged, ProjectListItem, PushChannel, PushEvents, ReviewPlan,
  ReviewScopeArg, Row, Snapshot, UnitDetail,
} from '../shared/api.js';
import type * as glossaryTypes from '../core/glossary/types.js';
import { DEFAULT_STYLE_GUIDE } from '../core/glossary/store.js';
import { detectSpeakerPattern } from '../core/text/speaker.js';
import { runClaudeJson } from './claude/json.js';
import { DraftJob, planDraft, type DraftMode, type DraftOptions } from './translate/draft.js';
import type { JobLike, JobOptions } from './translate/job.js';
import { TranslateJob } from './translate/job.js';
import { planReview, ReviewJob } from './translate/review.js';
import { computeScopes, computeStats, locationLabel, toRow } from '../shared/rows.js';
import { buildSystemPrompt } from './claude/prompt.js';
import type { ImportPlan as ExchangeImportPlan } from '../core/exchange/package.js';
import { DEFAULT_DECIDE_MODEL, type DecisionInput } from '../shared/api.js';
import { DecideJob } from './translate/decide.js';
import { ProjectService } from './projectService.js';
import { loadSettings, saveSettings } from './settings.js';
import { readFile } from 'node:fs/promises';
import { decryptAsset } from '../core/engine/crypto.js';
import type { FontInfo, PreviewInvokeChannel, PreviewState } from '../shared/api.js';
import { listFonts, systemFontDirs } from './fonts/catalog.js';
import { readFontInfo } from './fonts/fontFile.js';
import { PreviewService } from './preview.js';
import { buildScenes } from './story.js';
import type { RenderService } from './render/renderService.js';
import type { ImagesInvokeChannel } from '../shared/api.js';
import type { BuildDiff as CoreBuildDiff } from '../core/notes/diff.js';
import { ImageService, registerImageContributor, RerenderJob } from './images.js';
import { NotesJob, readBuildDiff, readBuildNotes, registerNotesContributor, setBuildNotes } from './buildNotes.js';
import { buildFolder, finishedBuilds } from '../core/notes/snapshot.js';
import { IMAGE_FOLDERS } from '../core/images/catalog.js';

// Compile-time check that the renderer-side copies in shared/api.ts match the core types.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const sharedTypesMatch: [
  Same<core.ProjectMeta, shared.ProjectMeta>, Same<core.BuildResult, shared.BuildResult>,
  Same<glossaryTypes.Glossary, shared.Glossary>, Same<glossaryTypes.Term, shared.Term>,
] = [true, true, true, true];

export const sharedTypesMatch3b: [Same<ExchangeImportPlan, shared.ImportPlan>] = [true];
export const sharedTypesMatch7: [Same<CoreBuildDiff, shared.BuildDiff>] = [true];

export const JOB_BUSY = '다른 작업이 진행 중입니다';
export const CONFIRM_FIRST = '용어집을 먼저 확정하세요';
const ACTIVE_STATES = new Set(['running', 'paused', 'paused-limit']);

export const CANNOT_RUN_CLAUDE = 'Claude CLI를 실행할 수 없습니다. 설정에서 경로를 확인하세요.';

/** What the IPC layer needs from a chat session (ClaudeChat in the app, a fake in tests). */
export interface ChatLike {
  readonly busy: boolean;
  send(text: string, images?: ChatImage[]): void;
  setModel(model: string): void;
  stop(): void;
  reset(): void;
  dispose(): void;
  on(event: 'event', listener: (e: ChatEvent) => void): unknown;
}

export interface IpcDeps {
  ipcMain: { handle(channel: string, listener: (event: unknown, ...args: any[]) => unknown): void };
  pickDirectory(): Promise<string | null>;
  settingsDir: string;
  documentsDir?: string;
  /** Holds the open project; the bridge reads it too. */
  holder: { svc: ProjectService | null };
  broadcast<C extends PushChannel>(channel: C, payload: PushEvents[C]): void;
  /** Creates a chat for the open project, or null when no Claude CLI can be found. */
  createChat(o: { cwd: string; systemPrompt: string; model: string; claudePath: string | null }): ChatLike | null;
  /** The CLI that would be used for this configured path (null = search PATH). */
  claudePath(configured: string | null): string | null;
  showItemInFolder(file: string): void;
  /** One-shot JSON calls for drafts, translation and review (runClaudeJson unless a test gives a fake). */
  runJson?: typeof runClaudeJson;
  /** The CLI for one-shot JSON calls (default: claudePath(configured) with no prefix arguments). */
  jsonClaude?(configured: string | null): { command: string; prefixArgs?: string[] } | null;
  /** Folders with installed fonts (default: the Windows font folders). */
  fontDirs?(): string[];
  /** Opens a file dialog for one .ttf/.otf font; null when cancelled. */
  pickFontFile?(): Promise<string | null>;
  /** Save dialog for an exchange package (null = cancelled). */
  pickSaveFile?(defaultName: string): Promise<string | null>;
  /** Open dialog for a translator's reply (null = cancelled). */
  pickOpenFile?(): Promise<string | null>;
  // ---- plan 7 ----
  /** Draws pictures (the hidden worker window in the app, a fake in tests). */
  render?: Pick<RenderService, 'render' | 'sheet' | 'thumbnail'>;
  /** Open dialog for a hand-fixed PNG (null = cancelled). */
  pickPngFile?(): Promise<string | null>;
}

const BAD_NAME = /[\\/:*?"<>|]/;

/** A project name from a game title: characters Windows file names cannot hold, and outer spaces and dots, removed. */
export function nameFromTitle(title: string, fallback: string): string {
  const clean = (s: string) => s.replace(/[\\/:*?"<>|]/g, '').replace(/^[\s.]+|[\s.]+$/g, '');
  return clean(title) || clean(fallback);
}

/** Checks a picked or dropped path: a file means its folder. Never throws. */
export async function inspectGameDir(input: string): Promise<shared.GameDirCheck> {
  try {
    let dir = path.resolve(String(input ?? ''));
    if (!(await stat(dir)).isDirectory()) dir = path.dirname(dir);
    const game = await detectGame(dir);
    let title = '';
    try {
      const sys = (await readJsonFile(path.join(game.contentDir, 'data', 'System.json'))) as { gameTitle?: unknown };
      if (typeof sys.gameTitle === 'string') title = sys.gameTitle.trim();
    } catch {
      // detectGame already read it; a title is optional
    }
    return { ok: true, dir, engine: game.engine, title, suggestedName: nameFromTitle(title, path.basename(dir)) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function readGameTitle(projectDir: string): Promise<string | null> {
  try {
    const meta = await openProject(projectDir);
    const sys = (await readJsonFile(path.join(originalDir(projectDir, meta), 'data', 'System.json'))) as { gameTitle?: unknown };
    return typeof sys.gameTitle === 'string' && sys.gameTitle ? sys.gameTitle : null;
  } catch {
    return null;
  }
}

function attachedPrefix(row: Row): string {
  return `[붙은 항목] id=${row.id} 위치=${row.location}\n원문: ${row.source}\n번역: ${row.target ?? '(번역 없음)'}\n\n`;
}

/** Registers every window.api handler. Returns a disposer used on app quit. */
export function registerIpc(deps: IpcDeps): { dispose(): Promise<void> } {
  let rows = new Map<string, Row>();
  let chat: ChatLike | null = null;
  let gameTitle: string | null = null;
  let job: JobLike | null = null;

  const settings = () => loadSettings(deps.settingsDir, deps.documentsDir);
  const svc = (): ProjectService => {
    if (!deps.holder.svc) throw new Error('열린 프로젝트가 없습니다');
    return deps.holder.svc;
  };
  const allRows = () => [...rows.values()];

  const handle = (channel: InvokeChannel, fn: (...args: any[]) => unknown) => {
    deps.ipcMain.handle(channel, (_event, ...args) => fn(...args));
  };

  function disposeChat(): void {
    chat?.dispose();
    chat = null;
  }

  async function closeProject(): Promise<void> {
    stopPreview();
    stopImages();
    disposeChat();
    job?.stop();
    job = null;
    const s = deps.holder.svc;
    deps.holder.svc = null;
    rows = new Map();
    gameTitle = null;
    await s?.close();
  }

  async function adopt(s: ProjectService): Promise<void> {
    await closeProject();
    deps.holder.svc = s;
    rows = new Map(s.units().map((u: TextUnit) => [u.id, toRow(u, s.entry(u.id), s.usesProvisional(u.id))]));
    gameTitle = await readGameTitle(s.projectDir);
    s.on('changed', (e) => {
      if (deps.holder.svc !== s) return;
      const changed: Row[] = [];
      for (const id of e.ids) {
        const u = s.unit(id);
        if (!u) continue;
        const r = toRow(u, s.entry(id), s.usesProvisional(id));
        rows.set(id, r);
        changed.push(r);
      }
      const all = allRows();
      const payload: ProjectChanged = { rows: changed, stats: computeStats(all), scopes: computeScopes(all), origin: e.origin };
      deps.broadcast('project:changed', payload);
    });
    s.on('glossary-changed', (g) => {
      if (deps.holder.svc !== s) return;
      deps.broadcast('glossary:changed', g);
      // Rows whose "uses a provisional term" mark changed.
      const changed: Row[] = [];
      for (const [id, r] of rows) {
        const u = s.unit(id);
        if (!u) continue;
        const next = toRow(u, s.entry(id), s.usesProvisional(id));
        if (next.usesProvisional !== r.usesProvisional) {
          rows.set(id, next);
          changed.push(next);
        }
      }
      if (changed.length > 0) {
        const all = allRows();
        deps.broadcast('project:changed', { rows: changed, stats: computeStats(all), scopes: computeScopes(all), origin: 'user' });
      }
    });
    await startPreview(s);
    s.on('decisions-changed', () => {
      if (deps.holder.svc !== s) return;
      deps.broadcast('decisions:changed', s.decisionGroups());
    });
    await startImages(s);
  }

  async function ensureChat(): Promise<ChatLike | null> {
    if (chat) return chat;
    const s = svc();
    const st = await settings();
    chat = deps.createChat({ cwd: s.projectDir, systemPrompt: buildSystemPrompt(s.meta, computeStats(allRows()), s.glossary().styleGuide), model: st.chatModel, claudePath: st.claudePath });
    chat?.on('event', (ev) => deps.broadcast('chat:event', ev));
    return chat;
  }

  async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
    const prev = await settings();
    const next = { ...prev, ...patch };
    await saveSettings(deps.settingsDir, next);
    if (next.claudePath !== prev.claudePath) disposeChat();
    else if (next.chatModel !== prev.chatModel) chat?.setModel(next.chatModel);
    deps.broadcast('settings:changed', next);
    return next;
  }

  handle('settings:get', () => settings());
  handle('settings:set', (patch: Partial<AppSettings>) => updateSettings(patch));

  handle('project:list', async (): Promise<ProjectListItem[]> => {
    const dir = (await settings()).projectsDir;
    if (!existsSync(dir)) return [];
    const out: ProjectListItem[] = [];
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const p = path.join(dir, e.name);
      try {
        const meta = await openProject(p);
        out.push({ dir: p, name: meta.name, engine: meta.engine });
      } catch {
        // not a project folder
      }
    }
    return out;
  });
  handle('project:pickGameDir', () => deps.pickDirectory());
  handle('project:inspectGameDir', (dir: string) => inspectGameDir(dir));
  handle('project:create', async (gameDir: string, name: string) => {
    const clean = String(name ?? '').trim();
    if (!clean) throw new Error('프로젝트 이름을 입력하세요');
    if (BAD_NAME.test(clean) || clean === '.' || clean === '..') throw new Error('프로젝트 이름에 쓸 수 없는 글자가 있습니다 (\\ / : * ? " < > |)');
    const dir = path.join((await settings()).projectsDir, clean);
    const existed = existsSync(dir);
    let created: ProjectService;
    try {
      created = await ProjectService.create(gameDir, dir, clean);
    } catch (e) {
      // Do not leave a half-made project folder behind (only one this call made).
      if (!existed) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
      throw e;
    }
    await adopt(created);
  });
  handle('project:open', async (dir: string) => { await adopt(await ProjectService.open(dir)); });
  handle('project:close', () => closeProject());
  handle('project:snapshot', (): Snapshot | null => {
    const s = deps.holder.svc;
    if (!s) return null;
    const all = allRows();
    return { meta: s.meta, gameTitle, rows: all, stats: computeStats(all), scopes: computeScopes(all) };
  });
  handle('project:undo', () => svc().undo());
  handle('project:build', () => svc().build());

  handle('unit:get', (id: string): UnitDetail => {
    const s = svc();
    const u = s.unit(id);
    if (!u) throw new Error(`없는 항목입니다: ${id}`);
    return { row: toRow(u, s.entry(id)), issues: s.issues(id), refs: u.refs.map((ref) => locationLabel({ ...u, refs: [ref] })) };
  });
  handle('unit:setTranslation', (id: string, target: string) => svc().setTranslation(id, target, 'user'));
  handle('unit:setStatus', (id: string, status: TranslationStatus) => svc().setStatus(id, status, 'user'));
  handle('unit:clear', (id: string) => svc().clearTranslation(id, 'user'));

  handle('chat:send', async (text: string, images: ChatImage[] = [], attachedUnitId?: string) => {
    let message = String(text ?? '');
    if (attachedUnitId) {
      const row = rows.get(attachedUnitId);
      if (row) message = attachedPrefix(row) + message;
    }
    const c = await ensureChat();
    if (!c) {
      deps.broadcast('chat:event', { type: 'error', message: CANNOT_RUN_CLAUDE });
      return;
    }
    c.send(message, images ?? []);
  });
  handle('chat:stop', () => { chat?.stop(); });
  handle('chat:reset', () => { chat?.reset(); });
  handle('chat:setModel', async (id: string) => {
    await updateSettings({ chatModel: id });
  });
  handle('chat:undo', () => svc().undo('chat'));

  // ---- glossary ----
  handle('glossary:get', () => svc().glossary());
  handle('glossary:upsertTerm', (t: Omit<glossaryTypes.Term, 'id'>) => svc().upsertTerm(t));
  handle('glossary:removeTerm', (id: string) => svc().removeTerm(id));
  handle('glossary:choose', (id: string, target: string) => svc().chooseCandidate(id, target));
  handle('glossary:setCharacters', (cards: glossaryTypes.CharacterCard[]) => svc().setCharacters(cards));
  handle('glossary:setStyleGuide', (text: string) => svc().setStyleGuide(String(text ?? '')));
  handle('glossary:setRules', (r: Partial<glossaryTypes.ProjectRules>) => svc().setRules(r));
  handle('glossary:confirm', () => svc().confirmGlossary());
  handle('glossary:detectSpeakerPattern', () => detectSpeakerPattern(svc().units()));
  handle('glossary:defaultStyleGuide', () => DEFAULT_STYLE_GUIDE);
  handle('unit:acceptReview', (id: string) => svc().acceptReview(id));
  handle('unit:rejectReview', (id: string) => svc().rejectReview(id));

  // ---- jobs (one at a time) ----
  function busy(): boolean {
    return job !== null && ACTIVE_STATES.has(job.progress.state);
  }

  async function jobOptions(stage: 'glossary' | 'translate' | 'review'): Promise<JobOptions> {
    const s = svc();
    const st = await settings();
    let claude: { command: string; prefixArgs?: string[] } | null;
    if (deps.jsonClaude) claude = deps.jsonClaude(st.claudePath);
    else {
      const command = deps.claudePath(st.claudePath);
      claude = command ? { command } : null;
    }
    if (!claude) throw new Error(CANNOT_RUN_CLAUDE);
    return { svc: s, call: deps.runJson ?? runClaudeJson, claude, model: st.stageModels[stage], cwd: s.projectDir };
  }

  /** Makes j the current job and starts it. Returns start()'s promise (resolves when it ends or pauses). */
  function launch(j: JobLike & { on(e: 'progress', l: (p: JobProgress) => void): unknown }): Promise<void> {
    if (busy()) throw new Error(JOB_BUSY);
    job = j;
    j.on('progress', (p) => { if (job === j) deps.broadcast('job:progress', p); });
    return j.start();
  }

  handle('job:current', () => job?.progress ?? null);
  const MODES: DraftMode[] = ['balanced', 'full', 'sample'];
  const pickMode = (m: unknown): DraftMode => (MODES.includes(m as DraftMode) ? (m as DraftMode) : 'balanced');
  /** Models for the two draft steps: the choice for this run, else settings (reading falls back to the glossary model). */
  async function draftModels(choice: DraftOptions | undefined): Promise<{ model: string; readModel: string }> {
    const sm = (await settings()).stageModels;
    const model = choice?.mergeModel || sm.glossary;
    return { model, readModel: choice?.readModel || sm.glossaryRead || model };
  }
  handle('job:draftPlan', async (mode: DraftMode, choice?: DraftOptions) => {
    const s = svc();
    const m = pickMode(mode);
    return { ...planDraft(s.units(), s.glossary(), m, choice?.budgetChars), ...(await draftModels(choice)) };
  });
  handle('job:draft', async (mode?: DraftMode, choice?: DraftOptions) => {
    if (busy()) throw new Error(JOB_BUSY);
    const o = await jobOptions('glossary');
    const { model, readModel } = await draftModels(choice);
    await launch(new DraftJob({ ...o, model, mode: pickMode(mode), budgetChars: choice?.budgetChars, readModel, mergeModel: model }));
  });
  handle('job:translate', async (ids?: string[]) => {
    if (busy()) throw new Error(JOB_BUSY);
    if (svc().glossary().confirmedAt === null) throw new Error(CONFIRM_FIRST);
    const o = await jobOptions('translate');
    void launch(new TranslateJob({ ...o, ids: Array.isArray(ids) && ids.length > 0 ? ids : undefined }));
  });
  handle('job:reviewPlan', async (scope: ReviewScopeArg): Promise<ReviewPlan> => {
    const s = svc();
    const r = planReview(s.units(), (id) => s.entry(id), s.glossary(), scope ?? { scope: 'all' });
    return { items: r.items, estimatedInputTokens: r.estimatedInputTokens, model: (await settings()).stageModels.review };
  });
  handle('job:review', async (scope: ReviewScopeArg) => {
    if (busy()) throw new Error(JOB_BUSY);
    const o = await jobOptions('review');
    void launch(new ReviewJob({ ...o, scope: scope ?? { scope: 'all' } }));
  });
  handle('job:pause', () => { job?.pause(); });
  handle('job:resume', () => { job?.resume(); });
  handle('job:stop', () => { job?.stop(); });

  handle('app:claudePath', async () => deps.claudePath((await settings()).claudePath));
  handle('app:showItemInFolder', (file: string) => { deps.showItemInFolder(file); });

  // ---- plan 4: preview and fonts ----
  let preview: PreviewService | null = null;
  /** Fonts the renderer may read: the last listed ones and the ones the user picked. */
  let listedFonts: FontInfo[] = [];
  const userFonts: FontInfo[] = [];
  const handleP = (channel: PreviewInvokeChannel, fn: (...args: any[]) => unknown) => {
    deps.ipcMain.handle(channel, (_event, ...args) => fn(...args));
  };
  const needPreview = (): PreviewService => {
    if (!preview) throw new Error('열린 프로젝트가 없습니다');
    return preview;
  };
  const previewState = (p: PreviewService): PreviewState => ({
    settings: p.settings(), metrics: p.metrics(), detected: p.detectedMetrics(), fontMissing: p.fontMissing, context: p.context(),
  });
  const announcePreview = () => { if (preview) deps.broadcast('preview:changed', previewState(preview)); };
  const fontKey = (p: string) => path.resolve(p).toLowerCase();

  async function startPreview(s: ProjectService): Promise<void> {
    const p = new PreviewService(s);
    try {
      await p.init();
    } catch {
      // the preview is optional; the project still opens
    }
    if (deps.holder.svc !== s) {
      p.dispose();
      return;
    }
    preview = p;
  }

  function stopPreview(): void {
    preview?.dispose();
    preview = null;
  }

  /** Content folder of the open project's game (where img/ and fonts/ live). */
  async function gameContent(s: ProjectService) {
    try {
      return await detectGame(s.meta.gameDir);
    } catch {
      return null;
    }
  }

  handleP('preview:get', () => previewState(needPreview()));
  handleP('preview:layout', (id: string, text?: string) => needPreview().layoutFor(String(id), typeof text === 'string' ? text : undefined));
  handleP('preview:setFont', async (p: string | null) => {
    await needPreview().setFont(typeof p === 'string' && p ? p : null);
    announcePreview();
  });
  handleP('preview:setOverrides', async (o: Partial<core.WindowMetrics>) => {
    await needPreview().setOverrides(o && typeof o === 'object' ? o : {});
    announcePreview();
  });
  handleP('preview:countOverflow', (p?: string | null) => needPreview().countOverflow(typeof p === 'string' && p ? p : undefined));
  handleP('preview:windowSkin', async (): Promise<Uint8Array | null> => {
    const game = await gameContent(svc());
    if (!game) return null;
    const dir = path.join(game.contentDir, 'img', 'system');
    const plain = path.join(dir, 'Window.png');
    try {
      if (existsSync(plain)) return new Uint8Array(await readFile(plain));
      for (const name of ['Window.png_', 'Window.rpgmvp']) {
        const f = path.join(dir, name);
        if (existsSync(f) && game.encryptionKey) return decryptAsset(new Uint8Array(await readFile(f)), game.encryptionKey);
      }
    } catch {
      // a broken skin means the default colors
    }
    return null;
  });

  handleP('fonts:list', async (): Promise<shared.FontList> => {
    const s = deps.holder.svc;
    const game = s ? await gameContent(s) : null;
    const r = await listFonts({
      systemDirs: deps.fontDirs?.() ?? systemFontDirs(),
      gameContentDir: game?.contentDir,
      projectFontsDir: s ? path.join(s.projectDir, 'fonts') : undefined,
      cacheFile: path.join(deps.settingsDir, 'fonts-cache.json'),
    });
    const seen = new Set(r.fonts.map((f) => fontKey(f.path)));
    listedFonts = [...r.fonts, ...userFonts.filter((f) => !seen.has(fontKey(f.path)))];
    return { fonts: listedFonts, skippedCollections: r.skippedCollections };
  });
  handleP('fonts:bytes', async (p: string): Promise<Uint8Array> => {
    const key = fontKey(String(p ?? ''));
    const chosen = preview?.settings().fontPath;
    const allowed = listedFonts.some((f) => fontKey(f.path) === key) || userFonts.some((f) => fontKey(f.path) === key)
      || (chosen ? fontKey(chosen) === key : false);
    if (!allowed) throw new Error('목록에 없는 폰트입니다');
    return new Uint8Array(await readFile(String(p)));
  });
  handleP('fonts:pickFile', async (): Promise<FontInfo | null> => {
    const file = deps.pickFontFile ? await deps.pickFontFile() : null;
    if (!file) return null;
    const info = await readFontInfo(file);
    if (!info) throw new Error('폰트 파일을 읽을 수 없습니다');
    const picked: FontInfo = { ...info, source: 'user' };
    const i = userFonts.findIndex((f) => fontKey(f.path) === fontKey(file));
    if (i >= 0) userFonts.splice(i, 1, picked);
    else userFonts.push(picked);
    if (!listedFonts.some((f) => fontKey(f.path) === fontKey(file))) listedFonts.push(picked);
    return picked;
  });

  handleP('story:scenes', (file: string) => {
    const s = svc();
    return buildScenes(s.projectDir, s.units(), String(file ?? ''), s.glossary().rules.speakerPattern);
  });

  // ---- decisions, game title, exchange (plan 3b) ----
  let importPlan: ExchangeImportPlan | null = null;
  handle('decisions:groups', () => svc().decisionGroups());
  handle('decisions:set', (key: string, d: DecisionInput) => svc().setDecision(String(key), { translate: !!d?.translate, keep: d?.keep ?? { mode: 'whole' }, ...(d?.reason !== undefined ? { reason: d.reason } : {}) }, 'user'));
  handle('decisions:confirm', (keys?: string[]) => svc().confirmSuggestions(Array.isArray(keys) ? keys : undefined));
  handle('decisions:clear', (key: string) => svc().clearDecision(String(key)));
  handle('job:decide', async () => {
    if (busy()) throw new Error(JOB_BUSY);
    const o = await jobOptions('glossary');
    const model = (await settings()).stageModels.decide || DEFAULT_DECIDE_MODEL;
    void launch(new DecideJob({ ...o, model }));
  });
  handle('project:setGameTitle', async (target: string) => {
    await svc().setGameTitle(String(target ?? ''));
  });
  handle('exchange:export', async (ids: string[]) => {
    const s = svc();
    const list = Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [];
    if (list.length === 0) throw new Error('내보낼 항목이 없습니다');
    const file = deps.pickSaveFile ? await deps.pickSaveFile(`${s.meta.name}_외부번역.json`) : null;
    if (!file) return null;
    await s.exportPackage(list, file);
    return file;
  });
  handle('exchange:planImport', async () => {
    const s = svc();
    const file = deps.pickOpenFile ? await deps.pickOpenFile() : null;
    if (!file) return null;
    importPlan = await s.importPackage(file);
    return importPlan;
  });
  handle('exchange:applyImport', async (overwrite: boolean) => {
    if (!importPlan) throw new Error('가져올 번역이 없습니다. 먼저 파일을 고르세요');
    const plan = importPlan;
    importPlan = null;
    return svc().applyImport(plan, overwrite === true);
  });

  // ---- plan 7: pictures and build history ----
  let images: ImageService | null = null;
  const handleI = (channel: ImagesInvokeChannel, fn: (...args: any[]) => unknown) => {
    deps.ipcMain.handle(channel, (_event, ...args) => fn(...args));
  };
  const noRender: Pick<RenderService, 'render' | 'sheet' | 'thumbnail'> = {
    render: () => Promise.reject(new Error('그림을 찍을 수 없습니다')),
    sheet: () => Promise.reject(new Error('그림을 찍을 수 없습니다')),
    thumbnail: () => Promise.reject(new Error('그림을 찍을 수 없습니다')),
  };
  const needImages = (): ImageService => {
    if (!images) throw new Error('열린 프로젝트가 없습니다');
    return images;
  };

  /** Makes the project's image service and registers the picture and notes contributors (the worker window starts on first use). */
  async function startImages(s: ProjectService): Promise<void> {
    const game = await gameContent(s);
    if (deps.holder.svc !== s) return;
    const im = new ImageService({ svc: s, game, render: deps.render ?? noRender });
    im.knownFonts = () => [...listedFonts, ...userFonts].map((f) => f.path);
    images = im;
    registerImageContributor(s, im);
    registerNotesContributor(s, { images: im });
    im.on('changed', (files) => {
      if (images !== im) return;
      void (async () => {
        const out: core.ImageEntry[] = [];
        for (const f of files) {
          const e = await im.entry(f).catch(() => undefined);
          if (e) out.push(e);
        }
        if (out.length > 0 && images === im) deps.broadcast('images:changed', out);
      })();
    });
  }

  function stopImages(): void {
    images?.removeAllListeners();
    images = null;
  }

  const fileArg = (f: unknown) => String(f ?? '');
  const whichArg = (w: unknown): 'original' | 'rendered' => (w === 'rendered' ? 'rendered' : 'original');
  handleI('images:list', () => (images ? images.list() : []));
  handleI('images:recipe', (file: string) => needImages().recipe(fileArg(file)));
  handleI('images:thumb', (file: string, which: string) => needImages().thumbnail(fileArg(file), whichArg(which)));
  handleI('images:full', (file: string, which: string) => (whichArg(which) === 'rendered' ? needImages().rendered(fileArg(file)) : needImages().original(fileArg(file))));
  handleI('images:setRecipe', (file: string, regions: unknown) => needImages().setRecipe(fileArg(file), Array.isArray(regions) ? regions : [], 'user'));
  handleI('images:setStatus', (file: string, status: core.ImageStatus) => needImages().setStatus(fileArg(file), status));
  handleI('images:pickManual', async (file: string) => {
    const im = needImages();
    const picked = deps.pickPngFile ? await deps.pickPngFile() : null;
    if (!picked) return false;
    await im.setManual(fileArg(file), picked);
    return true;
  });
  handleI('images:clearManual', (file: string) => needImages().setManual(fileArg(file), null));
  handleI('images:acceptBase', (file: string) => needImages().acceptBase(fileArg(file)));
  handleI('images:setDefaultFont', (p: string | null) => needImages().setDefaultFont(typeof p === 'string' && p ? p : null));
  handleI('images:defaultFont', () => images?.defaultFontPath ?? null);
  handleI('images:overflow', (file: string) => needImages().overflow(fileArg(file)));
  handleI('images:failure', (file: string) => needImages().failure(fileArg(file)) ?? null);
  handleI('images:folders', () => ({ folders: images ? images.folders() : [...IMAGE_FOLDERS], defaults: [...IMAGE_FOLDERS] }));
  handleI('images:setFolders', (folders: string[] | null) => needImages().setFolders(Array.isArray(folders) ? folders.map(String) : null));
  handleI('images:rerenderAll', () => {
    if (busy()) throw new Error(JOB_BUSY);
    void launch(new RerenderJob(needImages()));
  });

  handleI('builds:list', async (): Promise<shared.BuildRecord[]> => {
    const s = svc();
    const out: shared.BuildRecord[] = [];
    for (const n of await finishedBuilds(s.projectDir)) {
      const dir = buildFolder(s.projectDir, n);
      try {
        const manifest = (await readJsonFile(path.join(dir, 'manifest.json'))) as { createdAt: string; files: unknown[] };
        const zipName = (await readdir(dir)).find((x) => x.toLowerCase().endsWith('.zip')) ?? '';
        out.push({ number: n, createdAt: manifest.createdAt, zipPath: path.join(dir, zipName), files: manifest.files.length, notes: await readBuildNotes(s.projectDir, n), diff: await readBuildDiff(s.projectDir, n) });
      } catch {
        // a broken build folder is left out
      }
    }
    return out;
  });
  handleI('builds:setNotes', (number: number, text: string) => setBuildNotes(svc().projectDir, Number(number), String(text ?? '')));
  handleI('builds:polishNotes', async (number: number) => {
    if (busy()) throw new Error(JOB_BUSY);
    const o = await jobOptions('review');
    const model = (await settings()).stageModels.patchNotes;
    void launch(new NotesJob({ ...o, model, number: Number(number) }));
  });
  handleI('builds:openFolder', async (number: number) => {
    const dir = buildFolder(svc().projectDir, Number(number));
    const zipName = (await readdir(dir)).find((x) => x.toLowerCase().endsWith('.zip'));
    deps.showItemInFolder(zipName ? path.join(dir, zipName) : dir);
  });

  return { dispose: () => closeProject() };
}
