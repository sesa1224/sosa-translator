import { useSyncExternalStore } from 'react';
import { filterRows } from '../shared/rows';
import { num } from './format';
import { motionClock, ROW_FLASH_MS, type RowMotion } from './motion';
import type {
  Api, AppSettings, BuildResult, CharacterCard, GameDirCheck, DraftChoice, DraftMode, DraftPlan, ChatEvent, ChatImage, ChatUsage, ChooseResult, Glossary, Issue, ProjectChanged,
  JobProgress, LineDraft, ProjectListItem, ProjectMeta, ProjectRules, PromptKind, ReviewPlan, ReviewScopeArg, Row, RowQuery, Scope, Snapshot, SpeakerDetection, Stats, Term, TranslationStatus, UnitDetail,
} from '../shared/api';
import type {
  ActionDetail, ActionSummary, BuildRecord, CancelResult, ClaudeStatus, DecisionGroup, DecisionInput, EventRef, FontEmbedInfo, GameState, ImageEntry, ImageRecipe, ImageStatus, ImportPlan,
  NewPatch, Patch, PatchChange, PatchList, PathSeg, Rect, Region, StatusFilter, UpdateInspect, UpdateSummary, VersionInfo, UsageTarget,
} from '../shared/api';

// The renderer's single store: AppState plus the actions that change it. Screens read it with useApp() and
// call actions as useApp.x(), eventActions.x() or updateActions.x(). Actions call window.api; the main
// process pushes changes back through api.on(...) and the listeners in start() fold them into the state.

export type ChatMessage =
  | { kind: 'user'; text: string; images: ChatImage[]; attached: string | null }
  | { kind: 'assistant'; text: string; final: boolean }
  | { kind: 'tool'; id: string; name: string; input: unknown; done: boolean; isError: boolean }
  | { kind: 'error'; text: string };

export interface ChatState { messages: ChatMessage[]; busy: boolean; usage: ChatUsage; sessionModel: string | null }

export interface ProjectInfo { meta: ProjectMeta; gameTitle: string | null; stats: Stats; scopes: Scope[] }

export type BuildState =
  | { kind: 'idle' }
  | { kind: 'running' }
  | { kind: 'done'; result: BuildResult }
  | { kind: 'failed'; message: string };

export interface AppState {
  ready: boolean;
  settings: AppSettings | null;
  projects: ProjectListItem[];
  snapshot: ProjectInfo | null;
  rowOrder: string[];
  rowsById: Record<string, Row>;
  selectedId: string | null;
  detail: UnitDetail | null;
  query: RowQuery;
  /** The main screen. 'update' is the result of the last game update. */
  view: 'text' | 'settings' | 'glossary' | 'guide' | 'decisions' | 'images' | 'builds' | 'events' | 'patches' | 'update' | 'history';
  glossary: Glossary | null;
  /** The glossary was edited after it was confirmed (this session). */
  glossaryDirty: boolean;
  /** When set, the text table shows only these rows (e.g. lines to check after a term change). */
  idFilter: string[] | null;
  /** The last translation/review/draft job's progress (null = none this session). */
  job: JobProgress | null;
  /** The user closed the job bar; it comes back with the next progress event. */
  jobDismissed: boolean;
  rightTab: 'item' | 'chat';
  /** The selected line's game preview is drawn large over the text table ("크게 보며 고치기"). */
  bigPreview: boolean;
  /** When the stage was last opened (motionClock time): only a stage opened just now unfolds. */
  bigPreviewOpenedAt?: number;
  /** Table rows that just changed, for their one-off animation (kept a little longer than it plays). */
  rowMotion: Record<string, RowMotion>;
  attachedId: string | null;
  chat: ChatState;
  claudePath: string | null;
  /** The window is maximized (the title bar's maximize button shows "restore"). */
  windowMaximized: boolean;
  lastSaved: Date | null;
  build: BuildState;
  /** Bumped when something asks to show the game font picker (it scrolls into view). */
  fontPickerRequest: number;
  /** How the text view shows lines: the table, or scenes read in order. */
  textMode: 'table' | 'story';
  /** Needs-decision groups (loaded when the decisions screen opens, then pushed on change). */
  decisionGroups: DecisionGroup[];
  /** The card the decisions screen should scroll to (from an item's "묶음 보기"). */
  decisionFocus: string | null;
  /** The game's pictures (null until loaded for the open project). */
  images: ImageEntry[] | null;
  /** The picture open on the image screen. */
  imageFile: string | null;
  /** A picture attached to the next chat message. */
  attachedImage: string | null;
  /** Finished builds, newest first (null until the build history opens). */
  builds: BuildRecord[] | null;
  /** Patches and their state (loaded when needed, then pushed on change). */
  patchList?: PatchList;
  game?: GameState;
  gameError?: string | null;
  attachedEvent?: AttachedEvent | null;
  eventFocus?: EventFocus | null;
  /** Text the chat box should take (from "Claude에게 맡기기"). */
  chatDraft?: string | null;
  /** The "new version" dialog is open. */
  updateOpen?: boolean;
  /** The summary of the update that brought the current version (null = none; undefined = not loaded yet). */
  updateSummary?: UpdateSummary | null;
  /** The filter the image screen opens with (from the update result's "보기"). */
  imageFilter?: string | null;
  /** Whether the Claude CLI is there and logged in (undefined until checked). */
  claudeStatus?: ClaudeStatus | null;
  /** The last build's font embedding (null = none this session). */
  fontEmbed?: FontEmbedInfo | null;
  /** The action log, newest first (null until the log screen opens, then pushed on change). */
  history?: ActionSummary[] | null;
  /** Short notes in the window's lower right (a job ended, an undo, an import or export); each leaves after TOAST_MS. */
  toasts: Toast[];
  /** The command search (Ctrl+K) is open. */
  paletteOpen: boolean;
  /** The "번역 전체 검수" dialog is open (from the button above the table or the command search). */
  reviewOpen: boolean;
}

/** One note; out is set shortly before it leaves so it can slide away. */
export interface Toast { id: number; text: string; out: boolean }

/** How long a note stays, and the part at its end in which it slides away (the mockup's .toast). */
export const TOAST_MS = 3000;
const TOAST_OUT_MS = 250;

/** An event the chat message will carry. */
export interface AttachedEvent { file: string; listPath: PathSeg[]; label: string }
/** Where the event screen should open (from a usage result, a patch, or the patches screen). */
export interface EventFocus { file: string; listPath: PathSeg[]; line: number | null; seq: number }

const ZERO: ChatUsage = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };

function addUsage(a: ChatUsage, b: ChatUsage): ChatUsage {
  return { input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead, cacheCreate: a.cacheCreate + b.cacheCreate };
}

function initial(): AppState {
  return {
    ready: false, settings: null, projects: [], snapshot: null, rowOrder: [], rowsById: {}, selectedId: null, detail: null,
    query: { status: 'all' }, view: 'text', rightTab: 'item', bigPreview: false, rowMotion: {}, attachedId: null, glossary: null, glossaryDirty: false, idFilter: null, job: null, jobDismissed: false,
    chat: { messages: [], busy: false, usage: { ...ZERO }, sessionModel: null },
    claudePath: null, windowMaximized: false, lastSaved: null, build: { kind: 'idle' },
    fontPickerRequest: 0,
    textMode: 'table',
    decisionGroups: [], decisionFocus: null,
    images: null, imageFile: null, attachedImage: null, builds: null,
    toasts: [], paletteOpen: false, reviewOpen: false,
  };
}

let state: AppState = initial();
let toastSeq = 0;
let toastTimers: ReturnType<typeof setTimeout>[] = [];
let api: Api | null = null;
const listeners = new Set<() => void>();

function set(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  // The stage edits the item tab's draft, so it cannot stay open once the chat takes that place. Checked here
  // because many actions switch to the chat (talkAbout, attaching a picture or an event, chat drafts).
  if (state.rightTab === 'chat' && state.bigPreview) state = { ...state, bigPreview: false };
  for (const l of listeners) l();
}

function need(): Api {
  if (!api) throw new Error('앱이 아직 준비되지 않았습니다');
  return api;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function applyTheme(s: AppSettings | null): void {
  if (!s || typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  // theme.css stops every animation and transition under data-motion="off" (and under the system's reduced motion).
  root.dataset.motion = s.motion === false ? 'off' : 'on';
}

function adoptSnapshot(snap: Snapshot | null): void {
  if (!snap) {
    set({ snapshot: null, rowOrder: [], rowsById: {}, selectedId: null, detail: null, attachedId: null, glossary: null, glossaryDirty: false, idFilter: null });
    return;
  }
  const rowsById: Record<string, Row> = {};
  for (const r of snap.rows) rowsById[r.id] = r;
  set({
    snapshot: { meta: snap.meta, gameTitle: snap.gameTitle, stats: snap.stats, scopes: snap.scopes },
    rowOrder: snap.rows.map((r) => r.id), rowsById, selectedId: null, detail: null, attachedId: null, rowMotion: {},
    query: { status: 'all' }, view: 'text', rightTab: 'item', bigPreview: false, build: { kind: 'idle' }, idFilter: null, glossaryDirty: false,
    chat: { messages: [], busy: false, usage: { ...ZERO }, sessionModel: null },
  });
}

/** rowMotion with these rows marked as changed now, dropping marks whose animation is long over. */
function withRowMotion(prev: Record<string, RowMotion>, marks: [string, Omit<RowMotion, 'at'>][]): Record<string, RowMotion> {
  if (marks.length === 0) return prev;
  const at = motionClock.now();
  const next: Record<string, RowMotion> = {};
  for (const [id, m] of Object.entries(prev)) if (at - m.at < ROW_FLASH_MS * 2) next[id] = m;
  for (const [id, m] of marks) {
    // The same change often arrives twice (an approval marks at once, then the main process reports it): while the
    // first is still playing they merge, since a new start time would cut the running animation short.
    const old = next[id];
    next[id] = old && at - old.at < ROW_FLASH_MS ? { at: old.at, flash: old.flash || m.flash, pop: old.pop || m.pop } : { at, ...m };
  }
  return next;
}

function onProjectChanged(e: ProjectChanged): void {
  set((s) => {
    if (!s.snapshot) return {};
    const rowsById = { ...s.rowsById };
    // A translation a job just wrote flashes its row once; a status that changed (any way) pops its pill.
    // Only real changes are marked, so rows never animate because they scrolled back into view or got picked.
    const working = jobActive(s);
    const marks: [string, Omit<RowMotion, 'at'>][] = [];
    for (const r of e.rows) {
      const before = s.rowsById[r.id];
      rowsById[r.id] = r;
      if (!before) continue;
      const flash = working && r.target !== null && r.target !== before.target;
      const pop = r.status !== before.status || r.needsDecision !== before.needsDecision;
      if (flash || pop) marks.push([r.id, { flash, pop }]);
    }
    return { rowsById, snapshot: { ...s.snapshot, stats: e.stats, scopes: e.scopes }, lastSaved: new Date(), rowMotion: withRowMotion(s.rowMotion, marks) };
  });
  const sel = state.selectedId;
  if (sel && e.rows.some((r) => r.id === sel)) void refreshDetail(sel);
}

function onGlossaryChanged(g: Glossary): void {
  set((s) => {
    const prev = s.glossary;
    const dirty = g.confirmedAt === null ? false
      : prev !== null && prev.confirmedAt === g.confirmedAt ? s.glossaryDirty || JSON.stringify(prev) !== JSON.stringify(g) : false;
    return { glossary: g, glossaryDirty: dirty };
  });
}

async function loadGlossary(): Promise<void> {
  try {
    const g = await need().glossary.get();
    set({ glossary: g, glossaryDirty: false });
  } catch {
    set({ glossary: null });
  }
}

function finalizeStreaming(messages: ChatMessage[]): ChatMessage[] {
  const last = messages.at(-1);
  if (last?.kind === 'assistant' && !last.final) return [...messages.slice(0, -1), { ...last, final: true }];
  return messages;
}

/** Folds one chat event into the chat state. */
export function reduceChat(c: ChatState, ev: ChatEvent): ChatState {
  const msgs = c.messages;
  const last = msgs.at(-1);
  switch (ev.type) {
    case 'session':
      return { ...c, sessionModel: ev.model };
    case 'text-delta':
      if (last?.kind === 'assistant' && !last.final) return { ...c, messages: [...msgs.slice(0, -1), { ...last, text: last.text + ev.text }] };
      return { ...c, messages: [...msgs, { kind: 'assistant', text: ev.text, final: false }] };
    case 'text':
      if (last?.kind === 'assistant' && !last.final) return { ...c, messages: [...msgs.slice(0, -1), { kind: 'assistant', text: ev.text, final: true }] };
      return { ...c, messages: [...msgs, { kind: 'assistant', text: ev.text, final: true }] };
    case 'tool-start':
      return { ...c, messages: [...finalizeStreaming(msgs), { kind: 'tool', id: ev.id, name: ev.name, input: ev.input, done: false, isError: false }] };
    case 'tool-end':
      return { ...c, messages: msgs.map((m) => (m.kind === 'tool' && m.id === ev.id ? { ...m, done: true, isError: ev.isError } : m)) };
    case 'turn-end': {
      const usage = addUsage(c.usage, ev.usage);
      const messages = finalizeStreaming(msgs);
      return { ...c, busy: false, usage, messages: ev.ok ? messages : [...messages, { kind: 'error', text: ev.error ?? '오류가 났습니다' }] };
    }
    case 'error':
      return { ...c, busy: false, messages: [...finalizeStreaming(msgs), { kind: 'error', text: ev.message }] };
    default:
      return c;
  }
}

/** Shows a short note. Errors are not shown this way: they stay where they happened until dealt with. */
function notify(text: string): void {
  const id = ++toastSeq;
  set((s) => ({ toasts: [...s.toasts, { id, text, out: false }] }));
  toastTimers.push(
    setTimeout(() => set((s) => ({ toasts: s.toasts.map((t) => (t.id === id ? { ...t, out: true } : t)) })), TOAST_MS - TOAST_OUT_MS),
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), TOAST_MS),
  );
}

/** What a job's end says, for the jobs whose end the user waits on (null = no note). */
function jobDoneText(p: JobProgress): string | null {
  if (p.kind === 'translate') return `${num(p.done)}줄을 번역했습니다`;
  if (p.kind === 'review') return `${num(p.done)}줄을 검수했습니다`;
  if (p.kind === 'draft') return '용어집 초안을 만들었습니다';
  return null;
}

function onJobProgress(p: JobProgress): void {
  // Only the moment a job ends: the same end reported again, or a finished job read at start, says nothing.
  const ended = p.state === 'done' && state.job !== null && state.job.state !== 'done';
  set({ job: p, jobDismissed: false });
  const text = ended ? jobDoneText(p) : null;
  if (text) notify(text);
}

function undoneText(restored: number, skipped = 0): string {
  return `${num(restored)}줄을 되돌렸습니다${skipped > 0 ? ` · 건너뜀 ${num(skipped)}줄` : ''}`;
}

async function refreshDetail(id: string): Promise<void> {
  try {
    const d = await need().unit.get(id);
    if (state.selectedId === id) set({ detail: d });
  } catch {
    if (state.selectedId === id) set({ detail: null });
  }
}

let unsubscribe: (() => void)[] = [];

/** Connects the store to window.api and loads the first state. Resets everything; stop() disconnects. */
async function start(a: Api): Promise<void> {
  for (const u of unsubscribe) u();
  for (const t of toastTimers) clearTimeout(t);
  toastTimers = [];
  api = a;
  state = initial();
  unsubscribe = [
    a.on('project:changed', onProjectChanged),
    a.on('chat:event', (ev) => set((s) => ({ chat: reduceChat(s.chat, ev) }))),
    a.on('settings:changed', (s) => { applyTheme(s); set({ settings: s }); }),
    a.on('glossary:changed', onGlossaryChanged),
    a.on('job:progress', onJobProgress),
    a.on('decisions:changed', (g) => set({ decisionGroups: g })),
    a.on('patches:changed', (l) => set({ patchList: l })),
    a.on('game:state', (g) => set({ game: g })),
    a.on('images:changed', onImagesChanged),
    a.on('job:progress', reloadBuildsAfterNotes),
    a.on('project:reloaded', onReloaded),
    a.on('history:changed', (list) => set({ history: list })),
    a.on('window:maximized', (m) => set({ windowMaximized: m })),
  ];
  const [settings, projects, snap, claudePath, windowMaximized] = await Promise.all([
    a.settings.get(), a.project.list().catch(() => []), a.project.snapshot().catch(() => null), a.app.claudePath().catch(() => null),
    a.windowControls.isMaximized().catch(() => false),
  ]);
  applyTheme(settings);
  set({ settings, projects, claudePath, windowMaximized });
  adoptSnapshot(snap);
  if (snap) await loadGlossary();
  const job = snap ? await a.job.current().catch(() => null) : null;
  set({ ready: true, job: job ?? null });
}

function stop(): void {
  for (const u of unsubscribe) u();
  unsubscribe = [];
  for (const t of toastTimers) clearTimeout(t);
  toastTimers = [];
}

const actions = {
  get: (): AppState => state,
  start,
  stop,

  async refreshProjects(): Promise<void> {
    set({ projects: await need().project.list() });
  },
  pickGameDir: (): Promise<string | null> => need().project.pickGameDir(),
  inspectGameDir: (dir: string): Promise<GameDirCheck> => need().project.inspectGameDir(dir),
  unpackGame: (exe: string): Promise<string> => need().project.unpackGame(exe),
  pathForDrop: (file: File): string => need().project.pathForDrop(file),
  async createProject(gameDir: string, name: string): Promise<void> {
    await need().project.create(gameDir, name);
    adoptSnapshot(await need().project.snapshot());
    await loadGlossary();
  },
  async openProject(dir: string): Promise<void> {
    await need().project.open(dir);
    adoptSnapshot(await need().project.snapshot());
    await loadGlossary();
  },
  async closeProject(): Promise<void> {
    await need().project.close();
    adoptSnapshot(null);
    await actions.refreshProjects().catch(() => undefined);
  },

  setQuery(patch: RowQuery): void {
    set((s) => {
      const q = { ...s.query, ...patch };
      // Kinds differ per status (open remarks vs handled ones): a kind picked for one status would hide rows of the next.
      if (patch.status !== undefined && patch.status !== s.query.status && !('reviewKind' in patch)) delete q.reviewKind;
      for (const k of Object.keys(q) as (keyof RowQuery)[]) if (q[k] === undefined) delete q[k];
      return { query: q };
    });
  },
  toggleScope(file: string): void {
    actions.setQuery({ file: state.query.file === file ? undefined : file });
  },
  setView(view: AppState['view']): void {
    set({ view });
  },
  /** Shows only these rows in the text table (null shows everything again). */
  showRows(ids: string[] | null): void {
    set({ idFilter: ids, view: 'text', query: { status: 'all' } });
  },

  chooseTerm: (id: string, target: string): Promise<ChooseResult> => need().glossary.choose(id, target),
  upsertTerm: (t: Omit<Term, 'id'>): Promise<Term> => need().glossary.upsertTerm(t),
  removeTerm: (id: string): Promise<void> => need().glossary.removeTerm(id),
  setCharacters: (cards: CharacterCard[]): Promise<void> => need().glossary.setCharacters(cards),
  setStyleGuide: (text: string): Promise<void> => need().glossary.setStyleGuide(text),
  defaultStyleGuide: (): Promise<string> => need().glossary.defaultStyleGuide(),
  promptText: (kind: PromptKind): Promise<string> => need().glossary.promptText(kind),
  setPromptText: (kind: PromptKind, text: string | null): Promise<void> => need().glossary.setPromptText(kind, text),
  setRules: (rules: Partial<ProjectRules>): Promise<void> => need().glossary.setRules(rules),
  async confirmGlossary(): Promise<void> {
    await need().glossary.confirm();
    set({ glossaryDirty: false });
    await loadGlossary();
  },
  detectSpeakerPattern: (): Promise<SpeakerDetection | null> => need().glossary.detectSpeakerPattern(),
  draftGlossary: (mode?: DraftMode, choice?: DraftChoice): Promise<void> => need().job.draft(mode, choice),
  draftPlan: (mode: DraftMode, choice?: DraftChoice): Promise<DraftPlan> => need().job.draftPlan(mode, choice),

  /** Sends every untranslated line (or just these ids) to be translated. */
  translate: (ids?: string[]): Promise<void> => need().job.translate(ids),
  reviewPlan: (scope: ReviewScopeArg): Promise<ReviewPlan> => need().job.reviewPlan(scope),
  startReview: (scope: ReviewScopeArg): Promise<void> => need().job.review(scope),
  pauseJob: (): Promise<void> => need().job.pause(),
  resumeJob: (): Promise<void> => need().job.resume(),
  stopJob: (): Promise<void> => need().job.stop(),
  dismissJob(): void {
    set({ jobDismissed: true });
  },
  acceptReview: (id: string): Promise<Issue[]> => need().unit.acceptReview(id),
  rejectReview: (id: string): Promise<void> => need().unit.rejectReview(id),
  switchPastReview: (id: string): Promise<Issue[]> => need().unit.switchPastReview(id),
  acceptReviews: (ids: string[]): Promise<number> => need().unit.acceptReviews(ids),
  rejectReviews: (ids: string[]): Promise<number> => need().unit.rejectReviews(ids),
  setRightTab(rightTab: AppState['rightTab']): void {
    set({ rightTab });
  },
  /** Opens or closes the large preview; opening brings the item tab back, whose draft the stage edits. */
  setBigPreview(on: boolean): void {
    set(on ? { bigPreview: true, rightTab: 'item', bigPreviewOpenedAt: motionClock.now() } : { bigPreview: false });
  },
  async selectRow(id: string | null): Promise<void> {
    set({ selectedId: id, detail: null, ...(id ? { rightTab: 'item' as const, view: 'text' as const } : {}) });
    if (id) await refreshDetail(id);
  },
  attach(id: string | null): void {
    set({ attachedId: id });
  },
  talkAbout(id: string): void {
    set({ attachedId: id, rightTab: 'chat' });
  },

  saveTranslation: (id: string, target: string): Promise<Issue[]> => need().unit.setTranslation(id, target),
  setStatus: (id: string, status: TranslationStatus): Promise<void> => need().unit.setStatus(id, status),
  /** Approves a line; its table row flashes and its pill pops right away, before the change comes back. */
  async approve(id: string): Promise<void> {
    await need().unit.setStatus(id, 'approved');
    set((s) => ({ rowMotion: withRowMotion(s.rowMotion, [[id, { flash: true, pop: true }]]) }));
  },
  clearTranslation: (id: string): Promise<void> => need().unit.clear(id),
  /** One line translated by Claude on request (nothing is saved). What it cost goes on the status bar's usage. */
  async claudeDraft(id: string): Promise<LineDraft> {
    const d = await need().unit.claudeDraft(id);
    set((s) => ({ chat: { ...s.chat, usage: addUsage(s.chat.usage, d.usage) } }));
    return d;
  },
  async undo(): Promise<string[]> {
    const ids = await need().project.undo();
    if (ids.length > 0) notify(undoneText(ids.length));
    return ids;
  },
  notify,

  async build(): Promise<void> {
    set({ build: { kind: 'running' } });
    try {
      set({ build: { kind: 'done', result: await need().project.build() } });
    } catch (e) {
      set({ build: { kind: 'failed', message: errorText(e) } });
    }
  },
  dismissBuild(): void {
    set({ build: { kind: 'idle' } });
  },
  showInFolder: (file: string): Promise<void> => need().app.showItemInFolder(file),
  minimizeWindow: (): Promise<void> => need().windowControls.minimize(),
  toggleMaximizeWindow: (): Promise<void> => need().windowControls.toggleMaximize(),
  closeWindow: (): Promise<void> => need().windowControls.close(),

  async sendChat(text: string, images: ChatImage[]): Promise<void> {
    const attached = state.attachedId;
    const attachedLabel = attached ? state.rowsById[attached]?.location ?? null : null;
    set((s) => ({ chat: { ...s.chat, busy: true, messages: [...s.chat.messages, { kind: 'user', text, images, attached: attachedLabel }] } }));
    // A picture attached from the image screen goes in front of the message.
    if (state.attachedImage) {
      text = `[이미지] file=${state.attachedImage}\n\n${text}`;
      set({ attachedImage: null });
    }
    try {
      await need().chat.send(text, images, attached ?? undefined);
    } catch (e) {
      set((s) => ({ chat: reduceChat(s.chat, { type: 'error', message: errorText(e) }) }));
    }
  },
  stopChat: (): Promise<void> => need().chat.stop(),
  async resetChat(): Promise<void> {
    await need().chat.reset();
    set({ chat: { messages: [], busy: false, usage: { ...ZERO }, sessionModel: null } });
  },
  async undoChat(): Promise<string[]> {
    const ids = await need().chat.undo();
    if (ids.length > 0) notify(undoneText(ids.length));
    return ids;
  },
  async setChatModel(id: string): Promise<void> {
    await need().chat.setModel(id);
  },
  async updateSettings(patch: Partial<AppSettings>): Promise<void> {
    const s = await need().settings.set(patch);
    applyTheme(s);
    set({ settings: s });
    if ('claudePath' in patch) set({ claudePath: await need().app.claudePath().catch(() => null) });
  },
  /** Opens the settings at the game font picker. */
  openFontPicker(): void {
    set((s) => ({ view: 'settings', fontPickerRequest: s.fontPickerRequest + 1 }));
  },
  setTextMode(textMode: AppState['textMode']): void {
    set({ textMode });
  },
  async checkClaude(): Promise<void> {
    try {
      set({ claudeStatus: await need().app.claudeStatus() });
    } catch {
      set({ claudeStatus: null });
    }
  },

  // ---- decisions, game title, exchange ----
  async loadDecisionGroups(): Promise<void> {
    set({ decisionGroups: await need().decisions.groups() });
  },
  /** Opens the decisions screen, scrolled to key's card when given. */
  openDecisions(key: string | null = null): void {
    set({ view: 'decisions', decisionFocus: key });
  },
  setDecision: (key: string, d: DecisionInput): Promise<void> => need().decisions.set(key, d),
  confirmDecisions: (keys?: string[]): Promise<void> => (keys ? need().decisions.confirm(keys) : need().decisions.confirm()),
  clearDecision: (key: string): Promise<void> => need().decisions.clear(key),
  decide: (): Promise<void> => need().job.decide(),
  /** Shows the text table with only the lines of one decision group. */
  showDecisionRows(key: string): void {
    set((s) => ({ view: 'text', idFilter: null, query: { ...s.query, status: 'all', decisionKey: key } }));
  },
  setGameTitle: (target: string): Promise<void> => need().project.setGameTitle(target),
  async exportRows(ids: string[]): Promise<string | null> {
    const file = await need().exchange.export(ids);
    if (file) notify(`내보냈습니다 · ${file.split(/[\\/]/).pop()}`);
    return file;
  },
  planImport: (): Promise<ImportPlan | null> => need().exchange.planImport(),
  async applyImport(overwrite: boolean): Promise<{ written: number }> {
    const r = await need().exchange.applyImport(overwrite);
    notify(`번역 ${num(r.written)}개를 가져왔습니다`);
    return r;
  },

  // ---- pictures and build history ----
  async loadImages(): Promise<void> {
    try {
      set({ images: await need().images.list() });
    } catch {
      set({ images: [] });
    }
  },
  selectImage(file: string | null): void {
    set({ imageFile: file });
  },
  imageRecipe: (file: string): Promise<ImageRecipe | null> => need().images.recipe(file),
  saveRecipe: (file: string, regions: (Partial<Region> & { rect: Rect })[]): Promise<ImageRecipe> => need().images.setRecipe(file, regions),
  setImageStatus: (file: string, status: ImageStatus): Promise<void> => need().images.setStatus(file, status),
  pickManualImage: (file: string): Promise<boolean> => need().images.pickManual(file),
  clearManualImage: (file: string): Promise<void> => need().images.clearManual(file),
  /** Writes the decrypted originals into a folder the user picks; null when cancelled. */
  exportOriginalImages: (files: string[]): Promise<{ dir: string; written: number; failed: number } | null> => need().images.exportOriginals(files),
  acceptImageBase: (file: string): Promise<void> => need().images.acceptBase(file),
  setImageFont: (path: string | null): Promise<void> => need().images.setDefaultFont(path),
  rerenderImages: (): Promise<void> => need().images.rerenderAll(),
  /** Goes to the chat with the picture attached to the next message. */
  talkAboutImage(file: string): void {
    set({ attachedImage: file, rightTab: 'chat' });
  },
  detachImage(): void {
    set({ attachedImage: null });
  },
  async loadBuilds(): Promise<void> {
    try {
      set({ builds: await need().builds.list() });
    } catch {
      set({ builds: [] });
    }
  },
  async setBuildNotes(number: number, text: string): Promise<void> {
    await need().builds.setNotes(number, text);
    await actions.loadBuilds();
  },
  polishNotes: (number: number): Promise<void> => need().builds.polishNotes(number),
  openBuildFolder: (number: number): Promise<void> => need().builds.openFolder(number),
  async loadHistory(): Promise<void> {
    try {
      set({ history: await need().history.list() });
    } catch {
      set({ history: [] });
    }
  },
  /** The list follows from the 'history:changed' push; it is read again here so the screen does not wait on it. */
  async cancelAction(id: string): Promise<CancelResult> {
    const r = await need().history.cancel(id);
    notify(undoneText(r.restored, r.skipped));
    await actions.loadHistory();
    return r;
  },
  /** One page (100 lines) of an action's changed lines; the log screen keeps what it got. */
  loadActionDetail: (id: string, offset: number): Promise<ActionDetail> => need().history.detail(id, offset, 100),
  async rollbackTo(id: string): Promise<CancelResult> {
    const r = await need().history.rollback(id);
    notify(undoneText(r.restored, r.skipped));
    await actions.loadHistory();
    return r;
  },
};

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

function useAppState(): AppState {
  return useSyncExternalStore(subscribe, () => state);
}

/** Renderer store hook; static members are the actions (useApp.get(), useApp.selectRow(id), ...). */
export const useApp = Object.assign(useAppState, actions);

/** Whether a job is running or waiting to go on. */
export function jobActive(s: AppState): boolean {
  return s.job !== null && (s.job.state === 'running' || s.job.state === 'paused' || s.job.state === 'paused-limit');
}

/** Rows in project order. */
export function orderedRows(s: AppState): Row[] {
  return s.rowOrder.map((id) => s.rowsById[id]);
}

/** The rows the text table lists: project order, narrowed by the picked-lines filter and the query. */
export function shownRows(all: Row[], query: RowQuery, idFilter: string[] | null): Row[] {
  const only = idFilter ? new Set(idFilter) : null;
  return filterRows(only ? all.filter((r) => only.has(r.id)) : all, query);
}

// ---- events, patches, test play ----

/** The chat text with the attached event's line in front. */
export function withEventPrefix(text: string, ev: AttachedEvent | null | undefined): string {
  if (!ev) return text;
  return `[이벤트] file=${ev.file} listPath=${JSON.stringify(ev.listPath)} 라벨=${ev.label}

${text}`;
}

let focusSeq = 0;

/** Actions of the events and patches screens and test play. */
export const eventActions = {
  openEvents(focus: Omit<EventFocus, 'seq'> | null = null): void {
    set({ view: 'events', eventFocus: focus ? { ...focus, seq: ++focusSeq } : state.eventFocus ?? null });
  },
  openPatches(): void {
    set({ view: 'patches' });
  },
  async loadPatches(): Promise<void> {
    try {
      set({ patchList: await need().patches.list() });
    } catch {
      // no project open
    }
  },
  files: () => need().events.files(),
  list: (file: string) => need().events.list(file),
  read: (file: string, listPath: PathSeg[]) => need().events.read(file, listPath),
  usage: (target: UsageTarget): Promise<EventRef[]> => need().events.usage(target),
  async addPatch(p: NewPatch): Promise<Patch> {
    const r = await need().patches.add(p);
    await eventActions.loadPatches();
    return r;
  },
  async updatePatch(id: string, p: PatchChange): Promise<Patch> {
    const r = await need().patches.update(id, p);
    await eventActions.loadPatches();
    return r;
  },
  async removePatch(id: string): Promise<void> {
    await need().patches.remove(id);
    await eventActions.loadPatches();
  },
  async setGameFont(fontPath: string | null, subset: boolean): Promise<void> {
    await need().patches.setGameFont(fontPath, subset);
    await eventActions.loadPatches();
  },
  async setJosa(enabled: boolean): Promise<void> {
    await need().patches.setJosa(enabled);
    await eventActions.loadPatches();
  },
  josaConflicts: (): Promise<string[]> => need().patches.josaConflicts(),
  creatorReport: (): Promise<string> => need().patches.creatorReport(),
  /** Puts the event on the chat and shows the chat tab. */
  talkAboutEvent(ev: AttachedEvent): void {
    set({ attachedEvent: ev, rightTab: 'chat' });
  },
  attachEvent(ev: AttachedEvent | null): void {
    set({ attachedEvent: ev });
  },
  /** useApp.sendChat with the attached event's line in front of what the model reads. */
  async sendChat(text: string, images: ChatImage[]): Promise<void> {
    const ev = state.attachedEvent;
    if (!ev) return useApp.sendChat(text, images);
    const attached = state.attachedId;
    set((s) => ({ attachedEvent: null, chat: { ...s.chat, busy: true, messages: [...s.chat.messages, { kind: 'user', text, images, attached: `이벤트 · ${ev.label}` }] } }));
    try {
      await need().chat.send(withEventPrefix(text, ev), images, attached ?? undefined);
    } catch (e) {
      set((s) => ({ chat: reduceChat(s.chat, { type: 'error', message: errorText(e) }) }));
    }
  },
  async runGame(): Promise<void> {
    set({ gameError: null });
    try {
      await need().game.run();
    } catch (e) {
      set({ gameError: errorText(e) });
    }
  },
  stopGame: (): Promise<void> => need().game.stop(),
  /** Opens the chat with a draft message and, for an event patch, its event attached. */
  askClaude(text: string, ev: AttachedEvent | null): void {
    set({ chatDraft: text, rightTab: 'chat', ...(ev ? { attachedEvent: ev } : {}) });
  },
  takeChatDraft(): string | null {
    const d = state.chatDraft ?? null;
    if (d !== null) set({ chatDraft: null });
    return d;
  },
  async loadFontEmbed(): Promise<void> {
    try {
      set({ fontEmbed: await need().patches.lastFontEmbed() });
    } catch {
      set({ fontEmbed: null });
    }
  },
};

// ---- pictures and build history ----

/** Merges changed pictures into the list (new ones are added). */
function onImagesChanged(changed: ImageEntry[]): void {
  set((s) => {
    if (!s.images) return {};
    const byFile = new Map(changed.map((e) => [e.file, e]));
    const next = s.images.map((e) => byFile.get(e.file) ?? e);
    for (const e of changed) if (!s.images.some((x) => x.file === e.file)) next.push(e);
    return { images: next };
  });
}

/** A finished build or polished notes changes the build history; reload it when it is on screen. */
function reloadBuildsAfterNotes(p: JobProgress): void {
  if (p.kind === 'notes' && p.state === 'done' && state.builds !== null) void actions.loadBuilds();
}

// ---- game updates ----

/**
 * After an update or a rollback the main process opened the project again: the whole state follows the new snapshot,
 * the selection and filters are cleared, and lists read from the old version are dropped to load again.
 */
function onReloaded(snap: Snapshot): void {
  const onResult = state.view === 'update';
  adoptSnapshot(snap);
  set({ images: null, builds: null, history: null, decisionGroups: [], patchList: undefined, idFilter: null, imageFilter: null, ...(onResult ? { view: 'update' } : {}) });
  void loadGlossary();
  void updateActions.loadSummary();
}

/** Actions of the game update dialog and its result screen. */
export const updateActions = {
  open(): void {
    set({ updateOpen: true });
  },
  close(): void {
    set({ updateOpen: false });
  },
  pickGameDir: (): Promise<string | null> => need().update.pickGameDir(),
  inspect: (dir: string): Promise<UpdateInspect> => need().update.inspect(dir),
  pathForDrop: (file: File): string => need().project.pathForDrop(file),
  versions: (): Promise<VersionInfo[]> => need().update.versions(),
  /** Takes the new version and shows its result. */
  async importVersion(gameDir: string, label: string): Promise<void> {
    const summary = await need().update.import(gameDir, label);
    set({ updateSummary: summary, updateOpen: false, view: 'update', selectedId: null, detail: null });
  },
  async rollback(): Promise<void> {
    await need().update.rollback();
    set({ view: 'text', selectedId: null, detail: null });
    await updateActions.loadSummary();
  },
  async loadSummary(): Promise<void> {
    try {
      set({ updateSummary: await need().update.summary() });
    } catch {
      set({ updateSummary: null });
    }
  },
  openResult(): void {
    set({ view: 'update' });
  },
  /** The text table with one status filter (untranslated for new lines, changed for changed ones). */
  showStatus(status: StatusFilter): void {
    set({ view: 'text', idFilter: null, query: { status } });
  },
  showImageProblems(): void {
    set({ view: 'images', imageFilter: 'problem' });
  },
};
