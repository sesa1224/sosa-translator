import type { Issue, ReviewNote, TranslationStatus, UnitKind } from '../core/types.js';
import type { Decision, DecisionGroup, KeepRule } from '../core/decisions/types.js';

export interface Row {
  id: string; kind: UnitKind; speaker?: string; source: string;
  target: string | null; status: TranslationStatus; needsDecision: boolean;
  file: string;          // file of the first ref
  location: string;      // human-readable location, e.g. '맵4 · 이벤트3', 'Items · 1', '플러그인 설정'
  refCount: number;
  usesProvisional: boolean;   // translated, and the source holds a term still on its recommended candidate
  declinedReason?: string;
  review?: ReviewNote;
}
export type StatusFilter = 'all' | TranslationStatus | 'needs-decision' | 'provisional' | 'external' | 'skipped';
export interface RowQuery { text?: string; status?: StatusFilter; file?: string }
export interface Stats { total: number; untranslated: number; needsReview: number; approved: number; error: number; needsDecision: number; declined: number; provisional: number }
export interface Scope { file: string; label: string; total: number; done: number }   // done = rows with a target

export type Origin = 'user' | 'chat' | 'batch' | 'review' | 'external';
export interface ChangeEvent { ids: string[]; origin: Origin }

export interface ChatImage { mediaType: 'image/png' | 'image/jpeg' | 'image/webp'; base64: string }
export interface ChatUsage { input: number; output: number; cacheRead: number; cacheCreate: number }
export type ChatEvent =
  | { type: 'session'; sessionId: string; model: string }
  | { type: 'text-delta'; text: string }
  | { type: 'text'; text: string }
  | { type: 'tool-start'; id: string; name: string; input: unknown }
  | { type: 'tool-end'; id: string; isError: boolean; summary: string }
  | { type: 'turn-end'; ok: boolean; usage: ChatUsage; error?: string }
  | { type: 'error'; message: string };

export interface ModelOption { id: string; label: string }
/** glossaryRead: model for reading the script in a draft; missing = the glossary model. */
export interface StageModels { glossary: string; translate: string; review: string; patchNotes: string; glossaryRead?: string }
export type DraftMode = 'balanced' | 'full' | 'sample';
export interface DraftChoice { budgetChars?: number; readModel?: string; mergeModel?: string }
export interface DraftPlan { chunks: number; chars: number; estimatedInputTokens: number; model: string; readModel: string }
export interface AppSettings { theme: 'dark' | 'light'; models: ModelOption[]; chatModel: string; claudePath: string | null; projectsDir: string; stageModels: StageModels }
export const DEFAULT_STAGE_MODELS: StageModels = { glossary: 'claude-fable-5-2', translate: 'claude-opus-5-5', review: 'claude-fable-5-2', patchNotes: 'claude-haiku-5-5' };

export type JobKind = 'draft' | 'translate' | 'review' | 'decide';
export type JobState = 'idle' | 'running' | 'paused' | 'paused-limit' | 'done' | 'failed' | 'stopped';
export interface JobProgress { kind: JobKind; state: JobState; done: number; total: number; label: string; usage: ChatUsage; declined: number; errors: number; message?: string }
export const DEFAULT_MODELS: ModelOption[] = [
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2' }, { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' }, { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' } ];

// ---- IPC (window.api) ----------------------------------------------------------------


export interface ProjectListItem { dir: string; name: string; engine: string }
/** A checked game folder (dir is the folder actually used: a dropped file's folder). */
export type GameDirCheck =
  | { ok: true; dir: string; engine: 'MV' | 'MZ'; title: string; suggestedName: string }
  | { ok: false; error: string };
export interface Snapshot { meta: ProjectMeta; gameTitle: string | null; rows: Row[]; stats: Stats; scopes: Scope[] }
export interface UnitDetail { row: Row; issues: Issue[]; refs: string[] }
export interface ProjectChanged { rows: Row[]; stats: Stats; scopes: Scope[]; origin: Origin }
export type { Issue, ReviewNote, TranslationStatus, UnitKind };

// Copies of core types whose modules import node built-ins (the renderer cannot type-check those).
// src/main/ipc.ts checks at compile time that they still match the core ones.
export interface ProjectMeta {
  name: string; engine: 'MV' | 'MZ'; gameDir: string; contentPrefix: string; sourceLang: 'ja'; targetLang: 'ko';
  versions: { id: string; importedAt: string }[]; current: string;
}
// Copies of src/core/glossary/types.ts (checked in src/main/ipc.ts).
export type TermCategory = 'name' | 'place' | 'term' | 'sfx' | 'other';
export interface TermCandidate { target: string; reason: string }
export interface Term {
  id: string; source: string; target: string; category: TermCategory;
  status: 'confirmed' | 'provisional'; candidates: TermCandidate[]; note?: string;
}
export interface CharacterCard { id: string; source: string; target: string; speech: string; firstPerson?: string; addressing?: string; moanStyle?: string }
export interface ProjectRules {
  controlCodes: boolean; noLeftoverJapanese: boolean; sameLineCount: boolean; maxLines: number | null;
  maxLineWidthChars: number | null; speakerPattern: string | null;
}
export interface Glossary { terms: Term[]; characters: CharacterCard[]; styleGuide: string; rules: ProjectRules; confirmedAt: string | null }
export interface SpeakerDetection { pattern: string; presetId: string; coverage: number }
export interface ReviewScopeArg { scope: 'all' | 'unreviewed' | 'file'; file?: string }
export interface ReviewPlan { items: number; estimatedInputTokens: number; model: string }
export interface ChooseResult { changed: string[]; uncertain: string[] }

export interface BuildResult { number: number; zipPath: string; files: { path: string; sha1: string }[]; skippedErrors: number }

/** Events the main process pushes to every window. */
export interface PushEvents {
  'project:changed': ProjectChanged;
  'chat:event': ChatEvent;
  'settings:changed': AppSettings;
  'glossary:changed': Glossary;
  'job:progress': JobProgress;
  'preview:changed': PreviewState;
}
export type PushChannel = keyof PushEvents;

/** Request/response channels. Arguments and results as seen by the renderer. */
export interface InvokeChannels {
  'settings:get': () => AppSettings;
  'settings:set': (patch: Partial<AppSettings>) => AppSettings;
  'project:list': () => ProjectListItem[];
  'project:pickGameDir': () => string | null;
  'project:inspectGameDir': (dir: string) => GameDirCheck;
  'project:create': (gameDir: string, name: string) => void;
  'project:open': (dir: string) => void;
  'project:close': () => void;
  'project:snapshot': () => Snapshot | null;
  'project:undo': () => string[];
  'project:build': () => BuildResult;
  'unit:get': (id: string) => UnitDetail;
  'unit:setTranslation': (id: string, target: string) => Issue[];
  'unit:setStatus': (id: string, status: TranslationStatus) => void;
  'unit:clear': (id: string) => void;
  'unit:acceptReview': (id: string) => Issue[];
  'unit:rejectReview': (id: string) => void;
  'glossary:get': () => Glossary;
  'glossary:upsertTerm': (t: Omit<Term, 'id'>) => Term;
  'glossary:removeTerm': (id: string) => void;
  'glossary:choose': (id: string, target: string) => ChooseResult;
  'glossary:setCharacters': (cards: CharacterCard[]) => void;
  'glossary:setStyleGuide': (text: string) => void;
  'glossary:setRules': (rules: Partial<ProjectRules>) => void;
  'glossary:confirm': () => void;
  'glossary:detectSpeakerPattern': () => SpeakerDetection | null;
  'glossary:defaultStyleGuide': () => string;
  'job:draft': (mode?: DraftMode, choice?: DraftChoice) => void;
  'job:draftPlan': (mode: DraftMode, choice?: DraftChoice) => DraftPlan;
  'job:translate': (ids?: string[]) => void;
  'job:reviewPlan': (scope: ReviewScopeArg) => ReviewPlan;
  'job:review': (scope: ReviewScopeArg) => void;
  'job:pause': () => void;
  'job:resume': () => void;
  'job:stop': () => void;
  'job:current': () => JobProgress | null;
  'chat:send': (text: string, images: ChatImage[], attachedUnitId?: string) => void;
  'chat:stop': () => void;
  'chat:reset': () => void;
  'chat:setModel': (id: string) => void;
  'chat:undo': () => string[];
  'app:claudePath': () => string | null;
  'app:showItemInFolder': (file: string) => void;
}
export type InvokeChannel = keyof InvokeChannels;

type Async<F> = F extends (...a: infer A) => infer R ? (...a: A) => Promise<R> : never;

export interface Api {
  settings: { get: Async<InvokeChannels['settings:get']>; set: Async<InvokeChannels['settings:set']> };
  project: {
    list: Async<InvokeChannels['project:list']>; pickGameDir: Async<InvokeChannels['project:pickGameDir']>;
    inspectGameDir: Async<InvokeChannels['project:inspectGameDir']>;
    /** Path of a dropped file or folder (Electron webUtils; not an IPC call). */
    pathForDrop(file: File): string;
    create: Async<InvokeChannels['project:create']>; open: Async<InvokeChannels['project:open']>;
    close: Async<InvokeChannels['project:close']>; snapshot: Async<InvokeChannels['project:snapshot']>;
    undo: Async<InvokeChannels['project:undo']>; build: Async<InvokeChannels['project:build']>;
    setGameTitle: Async<InvokeChannels['project:setGameTitle']>;
  };
  unit: {
    get: Async<InvokeChannels['unit:get']>; setTranslation: Async<InvokeChannels['unit:setTranslation']>;
    setStatus: Async<InvokeChannels['unit:setStatus']>; clear: Async<InvokeChannels['unit:clear']>;
    acceptReview: Async<InvokeChannels['unit:acceptReview']>; rejectReview: Async<InvokeChannels['unit:rejectReview']>;
  };
  chat: {
    send: Async<InvokeChannels['chat:send']>; stop: Async<InvokeChannels['chat:stop']>; reset: Async<InvokeChannels['chat:reset']>;
    setModel: Async<InvokeChannels['chat:setModel']>; undo: Async<InvokeChannels['chat:undo']>;
  };
  glossary: {
    get: Async<InvokeChannels['glossary:get']>; upsertTerm: Async<InvokeChannels['glossary:upsertTerm']>;
    removeTerm: Async<InvokeChannels['glossary:removeTerm']>; choose: Async<InvokeChannels['glossary:choose']>;
    setCharacters: Async<InvokeChannels['glossary:setCharacters']>; setStyleGuide: Async<InvokeChannels['glossary:setStyleGuide']>;
    setRules: Async<InvokeChannels['glossary:setRules']>; confirm: Async<InvokeChannels['glossary:confirm']>;
    detectSpeakerPattern: Async<InvokeChannels['glossary:detectSpeakerPattern']>; defaultStyleGuide: Async<InvokeChannels['glossary:defaultStyleGuide']>;
  };
  job: {
    draft: Async<InvokeChannels['job:draft']>; draftPlan: Async<InvokeChannels['job:draftPlan']>; translate: Async<InvokeChannels['job:translate']>;
    reviewPlan: Async<InvokeChannels['job:reviewPlan']>; review: Async<InvokeChannels['job:review']>;
    pause: Async<InvokeChannels['job:pause']>; resume: Async<InvokeChannels['job:resume']>; stop: Async<InvokeChannels['job:stop']>;
    current: Async<InvokeChannels['job:current']>;
    decide: Async<InvokeChannels['job:decide']>;
  };
  app: { claudePath: Async<InvokeChannels['app:claudePath']>; showItemInFolder: Async<InvokeChannels['app:showItemInFolder']> };
  on<C extends PushChannel>(channel: C, cb: (payload: PushEvents[C]) => void): () => void;
  preview: PreviewApi;
  fonts: FontsApi;
  story: StoryApi;
}

// ---- plan 4: preview and fonts ----
/** A font file the app can use for the in-game preview (source: where it was found). */
export interface FontInfo { path: string; family: string; displayName: string; style: string; hasHangul: boolean; source: 'system' | 'user' | 'game' | 'project' }
export type { LaidLine, Layout, PreviewContext, PreviewSettings, Run, WindowMetrics } from '../core/preview/types.js';
/** What preview.get() and the 'preview:changed' event give. detected = before the user's overrides. */
export interface PreviewState {
  settings: import('../core/preview/types.js').PreviewSettings;
  metrics: import('../core/preview/types.js').WindowMetrics;
  detected: import('../core/preview/types.js').WindowMetrics;
  fontMissing: boolean;
  context: import('../core/preview/types.js').PreviewContext;
}
export interface OverflowCount { overflowing: number; checked: number; missingGlyphs: number }
export interface FontList { fonts: FontInfo[]; skippedCollections: number }
/** Plan 4 request/response channels (kept apart from InvokeChannels so that list stays as it was). */
export interface PreviewInvokeChannels {
  'preview:get': () => PreviewState;
  'preview:layout': (id: string, text?: string) => import('../core/preview/types.js').Layout | null;
  'preview:setFont': (path: string | null) => void;
  'preview:setOverrides': (o: Partial<import('../core/preview/types.js').WindowMetrics>) => void;
  'preview:countOverflow': (path?: string | null) => OverflowCount;
  'preview:windowSkin': () => Uint8Array | null;
  'fonts:list': () => FontList;
  'fonts:bytes': (path: string) => Uint8Array;
  'fonts:pickFile': () => FontInfo | null;
  'story:scenes': (file: string) => SceneInfo[];
}
export type PreviewInvokeChannel = keyof PreviewInvokeChannels;
type AsyncP<F> = F extends (...a: infer A) => infer R ? (...a: A) => Promise<R> : never;
export interface PreviewApi {
  get: AsyncP<PreviewInvokeChannels['preview:get']>; layout: AsyncP<PreviewInvokeChannels['preview:layout']>;
  setFont: AsyncP<PreviewInvokeChannels['preview:setFont']>; setOverrides: AsyncP<PreviewInvokeChannels['preview:setOverrides']>;
  countOverflow: AsyncP<PreviewInvokeChannels['preview:countOverflow']>; windowSkin: AsyncP<PreviewInvokeChannels['preview:windowSkin']>;
}
export interface FontsApi {
  list: AsyncP<PreviewInvokeChannels['fonts:list']>; bytes: AsyncP<PreviewInvokeChannels['fonts:bytes']>; pickFile: AsyncP<PreviewInvokeChannels['fonts:pickFile']>;
}
/** One line of a scene in the story view (order: position in the event's command list). */
export interface SceneLine { id: string; kind: UnitKind; order: number; speaker: string | null; choiceGroup?: number }
/** One event page (or common event, or troop page) read as a scene. */
export interface SceneInfo { key: string; file: string; label: string; condition: string | null; lines: SceneLine[] }
export interface StoryApi { scenes(file: string): Promise<SceneInfo[]> }
// ---- Plan 3b: decisions, title, exchange (added below; existing lines above are unchanged) ----

/** Plugin JS files left out of a build (merged into BuildResult above). */
export interface BuildResult { warnings: { file: string; message: string }[] }

export type { Decision, DecisionGroup, KeepRule };
/** A needs-decision row's state: no decision, confirmed (translate / skip), or only suggested. null for other rows. */
export type RowDecision = 'none' | 'translate' | 'skip' | 'suggested-translate' | 'suggested-skip';
/** Filled by toRow; optional so rows built by hand (tests, older callers) stay valid. */
export interface Row { decision?: RowDecision | null; external?: boolean; decisionKey?: string }
export interface RowQuery { decisionKey?: string }
/** undecided: needs-decision rows without a confirmed decision. */
export interface Stats { external: number; undecided: number }
export interface StageModels { decide?: string }
export const DEFAULT_DECIDE_MODEL = 'claude-fable-5-2';
/** Copy of src/core/exchange/package.ts ImportPlan (checked in src/main/ipc.ts). */
export interface ImportPlan {
  ok: { id: string; target: string; issues: Issue[] }[];
  conflicts: { id: string; current: string; incoming: string }[];
  unknownIds: string[];
  invalid: number;
}
export interface DecisionInput { translate: boolean; keep: KeepRule; reason?: string }
export interface PushEvents { 'decisions:changed': DecisionGroup[] }
export interface InvokeChannels {
  'decisions:groups': () => DecisionGroup[];
  'decisions:set': (key: string, d: DecisionInput) => void;
  'decisions:confirm': (keys?: string[]) => void;
  'decisions:clear': (key: string) => void;
  'job:decide': () => void;
  'project:setGameTitle': (target: string) => void;
  'exchange:export': (ids: string[]) => string | null;
  'exchange:planImport': () => ImportPlan | null;
  'exchange:applyImport': (overwrite: boolean) => { written: number };
}
export interface Api {
  decisions: {
    groups: Async<InvokeChannels['decisions:groups']>; set: Async<InvokeChannels['decisions:set']>;
    confirm: Async<InvokeChannels['decisions:confirm']>; clear: Async<InvokeChannels['decisions:clear']>;
  };
  exchange: {
    export: Async<InvokeChannels['exchange:export']>; planImport: Async<InvokeChannels['exchange:planImport']>;
    applyImport: Async<InvokeChannels['exchange:applyImport']>;
  };
}

// ---- Plan 5: events and patches (added below; existing lines above are unchanged) ----
export type { EventCommand, ListOp, Patch, PatchBody, PatchState, PatchStatus } from '../core/patches/types.js';
type PatchT = import('../core/patches/types.js').Patch;
type PatchBodyT = import('../core/patches/types.js').PatchBody;
type PathSegT = import('../core/types.js').PathSeg;
/** Copies of src/core/events types (checked in src/main/ipc.ts). count: commands the line stands for (a dialogue with its 401s). */
export interface EventLine { index: number; indent: number; text: string; code: number; count: number }
export interface EventFileInfo { file: string; label: string; events: number }
export interface EventListInfo { key: string; label: string; listPath: PathSegT[]; pages?: number; condition: string | null; commandCount: number }
export interface EventDetail { label: string; condition: string | null; hash: string; lines: EventLine[]; raw: import('../core/patches/types.js').EventCommand[] }
export interface EventRef { file: string; listPath: PathSegT[]; label: string; index: number; text: string; access: 'read' | 'write' }
export type UsageTarget = { type: 'switch' | 'variable' | 'commonEvent' | 'item' | 'picture'; id: number | string };
export interface PatchList { patches: PatchT[]; statuses: import('../core/patches/types.js').PatchStatus[] }
export interface NewPatch { title: string; note?: string; originalBug?: boolean; body: PatchBodyT }
export type PatchChange = Partial<Pick<PatchT, 'title' | 'note' | 'enabled' | 'originalBug'>> & { body?: PatchBodyT };
/** firstRun: the test-play copy is being made for the first time (slow). */
export interface GameState { state: 'idle' | 'preparing' | 'running'; done?: number; total?: number; firstRun?: boolean }
export interface PushEvents { 'patches:changed': PatchList; 'game:state': GameState }
/** Plan 5 request/response channels (kept apart from InvokeChannels so that list stays as it was). */
export interface EventInvokeChannels {
  'events:files': () => EventFileInfo[];
  'events:list': (file: string) => EventListInfo[];
  'events:read': (file: string, listPath: PathSegT[]) => EventDetail;
  'events:usage': (target: UsageTarget) => EventRef[];
  'patches:list': () => PatchList;
  'patches:add': (p: NewPatch) => PatchT;
  'patches:update': (id: string, p: PatchChange) => PatchT;
  'patches:remove': (id: string) => void;
  'patches:setGameFont': (fontPath: string | null, subset: boolean) => void;
  'patches:creatorReport': () => string;
  'game:run': () => void;
  'game:stop': () => void;
}
export type EventInvokeChannel = keyof EventInvokeChannels;
type AsyncE<F> = F extends (...a: infer A) => infer R ? (...a: A) => Promise<R> : never;
export interface EventsApi {
  files: AsyncE<EventInvokeChannels['events:files']>; list: AsyncE<EventInvokeChannels['events:list']>;
  read: AsyncE<EventInvokeChannels['events:read']>; usage: AsyncE<EventInvokeChannels['events:usage']>;
}
export interface PatchesApi {
  list: AsyncE<EventInvokeChannels['patches:list']>; add: AsyncE<EventInvokeChannels['patches:add']>;
  update: AsyncE<EventInvokeChannels['patches:update']>; remove: AsyncE<EventInvokeChannels['patches:remove']>;
  setGameFont: AsyncE<EventInvokeChannels['patches:setGameFont']>; creatorReport: AsyncE<EventInvokeChannels['patches:creatorReport']>;
}
export interface GameApi { run: AsyncE<EventInvokeChannels['game:run']>; stop: AsyncE<EventInvokeChannels['game:stop']> }
export interface Api { events: EventsApi; patches: PatchesApi; game: GameApi }
export type PathSeg = PathSegT;
