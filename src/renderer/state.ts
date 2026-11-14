import { useSyncExternalStore } from 'react';
import type {
  Api, AppSettings, BuildResult, CharacterCard, GameDirCheck, DraftChoice, DraftMode, DraftPlan, ChatEvent, ChatImage, ChatUsage, ChooseResult, Glossary, Issue, ProjectChanged,
  JobProgress, ProjectListItem, ProjectMeta, ProjectRules, PromptKind, ReviewPlan, ReviewScopeArg, Row, RowQuery, Scope, Snapshot, SpeakerDetection, Stats, Term, TranslationStatus, UnitDetail,
} from '../shared/api';
import type {
  BuildRecord, ClaudeStatus, DecisionGroup, DecisionInput, EventRef, FontEmbedInfo, GameState, ImageEntry, ImageRecipe, ImageStatus, ImportPlan,
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
  view: 'text' | 'settings' | 'glossary' | 'guide' | 'decisions' | 'images' | 'builds' | 'events' | 'patches' | 'update';
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
}

/** An event the chat message will carry. */
export interface AttachedEvent { file: string; listPath: PathSeg[]; label: string }
/** Where the event screen should open (from a usage result, a patch, or the patches screen). */
export interface EventFocus { file: string; listPath: PathSeg[]; line: number | null; seq: number }

const ZERO: ChatUsage = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };

function initial(): AppState {
  return {
    ready: false, settings: null, projects: [], snapshot: null, rowOrder: [], rowsById: {}, selectedId: null, detail: null,
    query: { status: 'all' }, view: 'text', rightTab: 'item', attachedId: null, glossary: null, glossaryDirty: false, idFilter: null, job: null, jobDismissed: false,
    chat: { messages: [], busy: false, usage: { ...ZERO }, sessionModel: null },
    claudePath: null, lastSaved: null, build: { kind: 'idle' },
    fontPickerRequest: 0,
    textMode: 'table',
    decisionGroups: [], decisionFocus: null,
    images: null, imageFile: null, attachedImage: null, builds: null,
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

/** Connects the store to window.api and loads the first state. Resets everything; stop() disconnects. */
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
    a.on('decisions:changed', (g) => set({ decisionGroups: g })),
    a.on('patches:changed', (l) => set({ patchList: l })),
    a.on('game:state', (g) => set({ game: g })),
    a.on('images:changed', onImagesChanged),
    a.on('job:progress', reloadBuildsAfterNotes),
    a.on('project:reloaded', onReloaded),
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
  exportRows: (ids: string[]): Promise<string | null> => need().exchange.export(ids),
  planImport: (): Promise<ImportPlan | null> => need().exchange.planImport(),
  applyImport: (overwrite: boolean): Promise<{ written: number }> => need().exchange.applyImport(overwrite),

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
  set({ images: null, builds: null, decisionGroups: [], patchList: undefined, idFilter: null, imageFilter: null, ...(onResult ? { view: 'update' } : {}) });
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
