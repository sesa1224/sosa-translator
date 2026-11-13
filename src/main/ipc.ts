import { existsSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { openProject, originalDir, readJsonFile, type TextUnit, type TranslationStatus } from '../core/index.js';
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
import { ProjectService } from './projectService.js';
import { loadSettings, saveSettings } from './settings.js';

// Compile-time check that the renderer-side copies in shared/api.ts match the core types.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export const sharedTypesMatch: [
  Same<core.ProjectMeta, shared.ProjectMeta>, Same<core.BuildResult, shared.BuildResult>,
  Same<glossaryTypes.Glossary, shared.Glossary>, Same<glossaryTypes.Term, shared.Term>,
] = [true, true, true, true];

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
}

const BAD_NAME = /[\\/:*?"<>|]/;

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

  return { dispose: () => closeProject() };
}
