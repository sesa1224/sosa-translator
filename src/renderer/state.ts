import { useSyncExternalStore } from 'react';
import type {
  Api, AppSettings, BuildResult, CharacterCard, GameDirCheck, DraftChoice, DraftMode, DraftPlan, ChatEvent, ChatImage, ChatUsage, ChooseResult, Glossary, Issue, ProjectChanged,
  JobProgress, ProjectListItem, ProjectMeta, ProjectRules, ReviewPlan, ReviewScopeArg, Row, RowQuery, Scope, Snapshot, SpeakerDetection, Stats, Term, TranslationStatus, UnitDetail,
} from '../shared/api';

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
  view: 'text' | 'settings' | 'glossary';
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
  attachedId: string | null;
  chat: ChatState;
  claudePath: string | null;
  lastSaved: Date | null;
  build: BuildState;
  /** Bumped when something asks to show the game font picker (it scrolls into view). */
  fontPickerRequest: number;
  /** How the text view shows lines: the table, or scenes read in order. */
  textMode: 'table' | 'story';
}

const ZERO: ChatUsage = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };

function initial(): AppState {
  return {
    ready: false, settings: null, projects: [], snapshot: null, rowOrder: [], rowsById: {}, selectedId: null, detail: null,
    query: { status: 'all' }, view: 'text', rightTab: 'item', attachedId: null, glossary: null, glossaryDirty: false, idFilter: null, job: null, jobDismissed: false,
    chat: { messages: [], busy: false, usage: { ...ZERO }, sessionModel: null },
    claudePath: null, lastSaved: null, build: { kind: 'idle' },
    fontPickerRequest: 0,
    textMode: 'table',
  };
}

let state: AppState = initial();
let api: Api | null = null;
const listeners = new Set<() => void>();

function set(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)): void {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
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
  if (s && typeof document !== 'undefined') document.documentElement.dataset.theme = s.theme;
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
    rowOrder: snap.rows.map((r) => r.id), rowsById, selectedId: null, detail: null, attachedId: null,
    query: { status: 'all' }, view: 'text', rightTab: 'item', build: { kind: 'idle' }, idFilter: null, glossaryDirty: false,
    chat: { messages: [], busy: false, usage: { ...ZERO }, sessionModel: null },
  });
}

function onProjectChanged(e: ProjectChanged): void {
  set((s) => {
    if (!s.snapshot) return {};
    const rowsById = { ...s.rowsById };
    for (const r of e.rows) rowsById[r.id] = r;
    return { rowsById, snapshot: { ...s.snapshot, stats: e.stats, scopes: e.scopes }, lastSaved: new Date() };
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

/** Folds one chat event into the chat state (exported for tests). */
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
      const usage = {
        input: c.usage.input + ev.usage.input, output: c.usage.output + ev.usage.output,
        cacheRead: c.usage.cacheRead + ev.usage.cacheRead, cacheCreate: c.usage.cacheCreate + ev.usage.cacheCreate,
      };
      const messages = finalizeStreaming(msgs);
      return { ...c, busy: false, usage, messages: ev.ok ? messages : [...messages, { kind: 'error', text: ev.error ?? '오류가 났습니다' }] };
    }
    case 'error':
      return { ...c, busy: false, messages: [...finalizeStreaming(msgs), { kind: 'error', text: ev.message }] };
    default:
      return c;
  }
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

/** Connects the store to window.api and loads the first state. Returns a disposer. Resets everything. */
async function start(a: Api): Promise<void> {
  for (const u of unsubscribe) u();
  api = a;
  state = initial();
  unsubscribe = [
    a.on('project:changed', onProjectChanged),
    a.on('chat:event', (ev) => set((s) => ({ chat: reduceChat(s.chat, ev) }))),
    a.on('settings:changed', (s) => { applyTheme(s); set({ settings: s }); }),
    a.on('glossary:changed', onGlossaryChanged),
    a.on('job:progress', (p) => set({ job: p, jobDismissed: false })),
  ];
  const [settings, projects, snap, claudePath] = await Promise.all([
    a.settings.get(), a.project.list().catch(() => []), a.project.snapshot().catch(() => null), a.app.claudePath().catch(() => null),
  ]);
  applyTheme(settings);
  set({ settings, projects, claudePath });
  adoptSnapshot(snap);
  if (snap) await loadGlossary();
  const job = snap ? await a.job.current().catch(() => null) : null;
  set({ ready: true, job: job ?? null });
}

function stop(): void {
  for (const u of unsubscribe) u();
  unsubscribe = [];
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
  setRightTab(rightTab: AppState['rightTab']): void {
    set({ rightTab });
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
  clearTranslation: (id: string): Promise<void> => need().unit.clear(id),
  undo: (): Promise<string[]> => need().project.undo(),

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

  async sendChat(text: string, images: ChatImage[]): Promise<void> {
    const attached = state.attachedId;
    const attachedLabel = attached ? state.rowsById[attached]?.location ?? null : null;
    set((s) => ({ chat: { ...s.chat, busy: true, messages: [...s.chat.messages, { kind: 'user', text, images, attached: attachedLabel }] } }));
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
  undoChat: (): Promise<string[]> => need().chat.undo(),
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
