// The contract between the main process and the renderer: every type the screens see, the push events,
// the request/response channels and the shape of window.api.
//
// The renderer cannot type-check modules that import node built-ins, so a few core types are copied here
// instead of imported. src/main/ipc.ts holds a compile-time check (sharedTypesMatch) that each copy still
// matches its core original; when a core type changes, that check fails until the copy is updated too.
//
// Adding a request/response channel takes four steps: the entry in InvokeChannels, the method in Api,
// the handler in src/main/ipc.ts and the call in src/preload/index.ts.
import type { Issue, PastReview, PathSeg, ReviewKind, ReviewNote, TranslationStatus, UnitKind } from '../core/types.js';
import type { Decision, DecisionGroup, KeepRule } from '../core/decisions/types.js';
import type { EventCommand, Patch, PatchBody, PatchStatus } from '../core/patches/types.js';
import type { ImageEntry, ImageRecipe, ImageStatus, Rect, Region } from '../core/images/types.js';
import type { Layout, PreviewContext, PreviewSettings, TextWindow, TextWindowInfo, WindowMetrics } from '../core/preview/types.js';
import type { UpdateSummary, VersionInfo } from '../core/update/types.js';
import type { ActionDetail, ActionSummary, CancelResult } from '../core/history/types.js';

export type { Issue, PastReview, ReviewKind, ReviewNote, TranslationStatus, UnitKind, PathSeg };
export { NO_REVIEW_KIND_LABEL, REVIEW_KIND_LABEL, REVIEW_KINDS } from '../core/types.js';
export type { Decision, DecisionGroup, KeepRule };
export type { EventCommand, ListOp, Patch, PatchBody, PatchState, PatchStatus } from '../core/patches/types.js';
export type { ImageEntry, ImageRecipe, ImageStatus, Rect, Region } from '../core/images/types.js';
export type { LaidLine, Layout, PreviewContext, PreviewSettings, Run, WindowMetrics } from '../core/preview/types.js';
export type { TextWindow, TextWindowInfo, WindowLimit, WindowOverride, WindowOverrides } from '../core/preview/types.js';
export { TEXT_WINDOW_LABEL, TEXT_WINDOWS } from '../core/preview/windows.js';
export type { PatchMove, UpdateSummary, VersionInfo } from '../core/update/types.js';
export type { ActionDetail, ActionLine, ActionOrigin, ActionPreview, ActionSide, ActionSummary, CancelResult } from '../core/history/types.js';

// ---- Rows, statistics and the project snapshot ----

/** One translatable sentence as the text table shows it (built by toRow in src/shared/rows.ts). */
export interface Row {
  id: string; kind: UnitKind; speaker?: string; source: string;
  target: string | null; status: TranslationStatus; needsDecision: boolean;
  file: string;          // file of the first ref
  location: string;      // human-readable location, e.g. '맵4 · 이벤트3', 'Items · 1', '플러그인 설정'
  refCount: number;
  usesProvisional: boolean;   // translated, and the source holds a term still on its recommended candidate
  declinedReason?: string;
  review?: ReviewNote;
  /** The last remark that was taken or passed over (the open one, if any, is in review). */
  pastReview?: PastReview;
  // The fields below are filled by toRow; optional so rows built by hand (tests, older callers) stay valid.
  decision?: RowDecision | null;
  external?: boolean;
  decisionKey?: string;
  /** The sentence's source and translation in the older version (a sentence a game update changed). */
  previous?: { source: string; target: string | null };
  /** previous.target was filled in as this sentence's translation. */
  carried?: boolean;
  /** The translation has a notation warning (src/core/check/notation.ts). */
  notation?: boolean;
  /** The translation does not fit the game window it is drawn in (too wide or too many lines; needs a game font). */
  overflow?: boolean;
}
/** A needs-decision row's state: no decision, confirmed (translate / skip), or only suggested. null for other rows. */
export type RowDecision = 'none' | 'translate' | 'skip' | 'suggested-translate' | 'suggested-skip';
export type StatusFilter = 'all' | TranslationStatus | 'needs-decision' | 'provisional' | 'external' | 'skipped' | 'changed' | 'review-taken' | 'review-passed' | 'notation' | 'overflow';
/** reviewKind: the kind of the open (else the last handled) remark; 'none' is a remark without a kind. */
export interface RowQuery { text?: string; status?: StatusFilter; file?: string; decisionKey?: string; reviewKind?: ReviewKind | 'none' }
/**
 * Counts for the sidebar and status bar. undecided: needs-decision rows without a confirmed decision;
 * changed: rows with a previous version's sentence; carried: those whose old translation was filled in.
 */
export interface Stats {
  total: number; untranslated: number; needsReview: number; approved: number; error: number; needsDecision: number; declined: number; provisional: number;
  external: number; undecided: number;
  changed: number; carried: number;
  /** Rows with a translation nobody raised a doubt about. needsReview counts only the ones waiting for a look. */
  translated: number;
  /** Rows whose last handled remark ended with the suggestion taken / with the translation kept. */
  reviewTaken?: number; reviewPassed?: number;
  /** Rows whose translation has a notation warning. */
  notation?: number;
  /** Rows whose translation does not fit its game window. */
  overflow?: number;
}
export interface Scope { file: string; label: string; total: number; done: number }   // done = rows with a target

/** Who made a change; the screen uses it to decide what to highlight and what undo takes back. */
export type Origin = 'user' | 'chat' | 'batch' | 'review' | 'external';
export interface ChangeEvent { ids: string[]; origin: Origin }

export interface ProjectListItem { dir: string; name: string; engine: string }
/** A game shipped as one exe (Enigma Virtual Box) that the app can unpack: the exe, and how much is inside. */
export interface PackedGameInfo { exe: string; files: number; bytes: number }
/**
 * A checked game folder (dir is the folder actually used: a dropped file's folder).
 * packed: the folder is not a game as it is, but it holds an exe that can be unpacked into one.
 */
export type GameDirCheck =
  | { ok: true; dir: string; engine: 'MV' | 'MZ'; title: string; suggestedName: string }
  | { ok: false; error: string; packed?: PackedGameInfo };
export interface Snapshot { meta: ProjectMeta; gameTitle: string | null; rows: Row[]; stats: Stats; scopes: Scope[] }
export interface UnitDetail { row: Row; issues: Issue[]; refs: string[] }
/** An earlier translation of a sentence like the selected one; score is the match in percent (0~100, whole). */
export interface SimilarTranslation { id: string; source: string; target: string; score: number; location: string }
export interface ProjectChanged { rows: Row[]; stats: Stats; scopes: Scope[]; origin: Origin }

// Copy of core ProjectMeta (checked in src/main/ipc.ts).
export interface ProjectMeta {
  name: string; engine: 'MV' | 'MZ'; gameDir: string; contentPrefix: string; sourceLang: 'ja'; targetLang: 'ko';
  versions: { id: string; importedAt: string; label?: string; gameDir?: string }[]; current: string;
}

// ---- Chat ----

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

/** Whether the Claude CLI can be used: found on this computer, and logged in (null = could not tell). */
export interface ClaudeStatus { found: boolean; path: string | null; loggedIn: boolean | null }

// ---- Settings and models ----

export interface ModelOption { id: string; label: string }
/** Model per job. glossaryRead: model for reading the script in a draft (missing = the glossary model); decide: missing = DEFAULT_DECIDE_MODEL. */
export interface StageModels { glossary: string; translate: string; review: string; patchNotes: string; glossaryRead?: string; decide?: string }
/** reviewSkipPassed: a review leaves out lines whose remark the user passed over and that are unchanged since. */
export interface AppSettings { theme: 'dark' | 'light'; models: ModelOption[]; chatModel: string; claudePath: string | null; projectsDir: string; stageModels: StageModels; reviewSkipPassed: boolean }
export const DEFAULT_STAGE_MODELS: StageModels = { glossary: 'claude-fable-5-2', translate: 'claude-opus-5-5', review: 'claude-fable-5-2', patchNotes: 'claude-haiku-5-5' };
export const DEFAULT_DECIDE_MODEL = 'claude-fable-5-2';
export const DEFAULT_MODELS: ModelOption[] = [
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2' }, { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' }, { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' } ];

// ---- Background jobs (one at a time) ----

export type JobKind = 'draft' | 'translate' | 'review' | 'decide' | 'notes' | 'images';
/** paused-limit: paused because the Claude usage limit was hit; it can be resumed later. */
export type JobState = 'idle' | 'running' | 'paused' | 'paused-limit' | 'done' | 'failed' | 'stopped';
export interface JobProgress { kind: JobKind; state: JobState; done: number; total: number; label: string; usage: ChatUsage; declined: number; errors: number; message?: string }
/** How a glossary draft reads the script: chosen excerpts, all of it, or not at all (the draft works from samples only). */
export type DraftMode = 'balanced' | 'full' | 'sample';
export interface DraftChoice { budgetChars?: number; readModel?: string; mergeModel?: string }
export interface DraftPlan { chunks: number; chars: number; estimatedInputTokens: number; model: string; readModel: string }
export interface ReviewScopeArg { scope: 'all' | 'unreviewed' | 'file'; file?: string }
/** skippedPassed: lines left out because the user passed their remark over (see AppSettings.reviewSkipPassed). */
export interface ReviewPlan { items: number; estimatedInputTokens: number; model: string; skippedPassed: number }

// ---- Glossary (copies of src/core/glossary/types.ts, checked in src/main/ipc.ts) ----

export type TermCategory = 'name' | 'place' | 'term' | 'sfx' | 'other';
export type TermScope = 'speaker' | 'name';
export interface TermCandidate { target: string; reason: string }
export interface Term {
  id: string; source: string; target: string; category: TermCategory;
  status: 'confirmed' | 'provisional'; candidates: TermCandidate[]; note?: string; scope?: TermScope;
}
export interface CharacterCard { id: string; source: string; target: string; speech: string; firstPerson?: string; addressing?: string; moanStyle?: string }
export interface ProjectRules {
  controlCodes: boolean; noLeftoverJapanese: boolean; sameLineCount: boolean; maxLines: number | null;
  maxLineWidthChars: number | null; speakerPattern: string | null; halfWidth: boolean; halfWidthBrackets: boolean;
  notationCheck: boolean; unmask: boolean; autoRewrap: boolean;
}
export type PromptKind = 'translate' | 'review' | 'export';
export interface Glossary {
  terms: Term[]; characters: CharacterCard[]; styleGuide: string; rules: ProjectRules; confirmedAt: string | null;
  prompts?: Partial<Record<PromptKind, string>>;
}
export interface SpeakerDetection { pattern: string; presetId: string; coverage: number }
/** Result of choosing a term's candidate: rows rewritten with it, and the uncertain rewrites sent back to needs-review. */
export interface ChooseResult { changed: string[]; uncertain: string[] }

// ---- Builds ----

/** warnings: plugin JS files left out of the build. */
export interface BuildResult { number: number; zipPath: string; files: { path: string; sha1: string }[]; skippedErrors: number; warnings: { file: string; message: string }[] }
/** Copy of src/core/notes/diff.ts BuildDiff (checked in src/main/ipc.ts). */
export interface BuildDiff {
  number: number; previous: number | null;
  newTranslations: number; changedTranslations: number; removedTranslations: number;
  byScope: { label: string; added: number; changed: number }[];
  newImages: string[]; changedImages: string[];
  addedFiles: string[]; removedFiles: string[];
  extras: Record<string, { added: string[]; removed: string[] }>;
}
/** One finished build for the build history screen. */
export interface BuildRecord { number: number; createdAt: string; zipPath: string; files: number; notes: string; diff: BuildDiff | null }

// ---- Decisions, game title, exchange ----

/** Copy of src/core/exchange/package.ts ImportPlan (checked in src/main/ipc.ts). */
export interface ImportPlan {
  ok: { id: string; target: string; issues: Issue[] }[];
  conflicts: { id: string; current: string; incoming: string }[];
  unknownIds: string[];
  invalid: number;
}
export interface DecisionInput { translate: boolean; keep: KeepRule; reason?: string }

// ---- Preview, fonts and story view ----

/** A font file the app can use for the in-game preview (source: where it was found). */
export interface FontInfo { path: string; family: string; displayName: string; style: string; hasHangul: boolean; source: 'system' | 'user' | 'game' | 'project' }
/** What preview.get() and the 'preview:changed' event give. detected = before the user's overrides. */
export interface PreviewState {
  settings: PreviewSettings;
  metrics: WindowMetrics;
  detected: WindowMetrics;
  fontMissing: boolean;
  context: PreviewContext;
  /** Each window's line width and line count (detected and in use). Optional for states made before windows had them. */
  windows?: Record<TextWindow, TextWindowInfo>;
}
export interface OverflowCount { overflowing: number; checked: number; missingGlyphs: number }
/** skippedCollections: font collection files (.ttc) found but not listed. */
export interface FontList { fonts: FontInfo[]; skippedCollections: number }
/** Which translations a rewrap looks at: all of them, those of one window, or the given ids. */
export interface RewrapScope { window?: TextWindow; ids?: string[] }
/**
 * Why a line could not be fitted: no space to break at, still too many lines, drawn in more than one kind of
 * place (only measured), or the check would find a new problem.
 */
export type RewrapReason = 'no-break' | 'too-many-lines' | 'mixed' | 'check';
/** What a rewrap fixed and could not fix, in all and per window. unfixableIds: every line it could not fix. */
export interface RewrapReport {
  fixed: number; unfixable: number;
  byWindow: Record<TextWindow, { fixed: number; unfixable: number }>;
  unfixableIds: string[];
  reasons: Partial<Record<RewrapReason, number>>;
}
/** A window's new line width and line count; null removes the user's value, a missing key keeps it. */
export interface WindowSetting { width?: number | null; maxLines?: number | null }
/** One line of a scene in the story view (order: position in the event's command list). */
export interface SceneLine { id: string; kind: UnitKind; order: number; speaker: string | null; choiceGroup?: number }
/** One event page (or common event, or troop page) read as a scene. */
export interface SceneInfo { key: string; file: string; label: string; condition: string | null; lines: SceneLine[] }

// ---- Events, patches and test play ----

/** Copies of src/core/events types (checked in src/main/ipc.ts). count: commands the line stands for (a dialogue with its 401s). */
export interface EventLine { index: number; indent: number; text: string; code: number; count: number }
export interface EventFileInfo { file: string; label: string; events: number }
export interface EventListInfo { key: string; label: string; listPath: PathSeg[]; pages?: number; condition: string | null; commandCount: number }
export interface EventDetail { label: string; condition: string | null; hash: string; lines: EventLine[]; raw: EventCommand[] }
export interface EventRef { file: string; listPath: PathSeg[]; label: string; index: number; text: string; access: 'read' | 'write' }
export type UsageTarget = { type: 'switch' | 'variable' | 'commonEvent' | 'item' | 'picture'; id: number | string };
export interface PatchList { patches: Patch[]; statuses: PatchStatus[] }
export interface NewPatch { title: string; note?: string; originalBug?: boolean; body: PatchBody }
export type PatchChange = Partial<Pick<Patch, 'title' | 'note' | 'enabled' | 'originalBug'>> & { body?: PatchBody };
/** firstRun: the test-play copy is being made for the first time (slow). */
export interface GameState { state: 'idle' | 'preparing' | 'running'; done?: number; total?: number; firstRun?: boolean }
/** The last build's font embedding: its size and how many used characters the font lacks. */
export interface FontEmbedInfo { bytes: number; missing: number }

// ---- Pictures ----

export interface RegionOverflow { overflowX: boolean; overflowY: boolean }
type ImageRegionInput = Partial<Region> & { rect: Rect };

// ---- Game updates ----

/** What update.inspect says about a folder picked as the game's new version. */
export type UpdateInspect =
  | { ok: true; engine: 'MV' | 'MZ'; title: string; suggestedLabel: string; sameGame: boolean; overlap: number; reason?: string }
  | { ok: false; error: string };

// ---- IPC: push events (main → every window) ----

export interface PushEvents {
  'project:changed': ProjectChanged;
  /** The whole project as it is after an update or a rollback (the screen starts over from it). */
  'project:reloaded': Snapshot;
  'chat:event': ChatEvent;
  'settings:changed': AppSettings;
  'glossary:changed': Glossary;
  'job:progress': JobProgress;
  'preview:changed': PreviewState;
  'decisions:changed': DecisionGroup[];
  'patches:changed': PatchList;
  'game:state': GameState;
  'images:changed': ImageEntry[];
  /** The action log, newest first, after an action was logged or cancelled. */
  'history:changed': ActionSummary[];
}
export type PushChannel = keyof PushEvents;

// ---- IPC: request/response channels (arguments and results as seen by the renderer) ----

export interface InvokeChannels {
  'settings:get': () => AppSettings;
  'settings:set': (patch: Partial<AppSettings>) => AppSettings;

  'project:list': () => ProjectListItem[];
  'project:pickGameDir': () => string | null;
  'project:inspectGameDir': (dir: string) => GameDirCheck;
  /** Unpacks a one-exe game into the projects folder and returns the folder it wrote. Reads the exe only. */
  'project:unpackGame': (exe: string) => string;
  'project:create': (gameDir: string, name: string) => void;
  'project:open': (dir: string) => void;
  'project:close': () => void;
  'project:snapshot': () => Snapshot | null;
  'project:undo': () => string[];
  'project:build': () => BuildResult;
  'project:setGameTitle': (target: string) => void;
  /** How many translations in scope a rewrap would fix and could not fix (nothing is written). */
  'project:rewrapPlan': (scope: RewrapScope) => RewrapReport;
  /** Moves the line breaks of translations in scope that do not fit their window (one logged action). */
  'project:rewrap': (scope: RewrapScope) => RewrapReport;

  'unit:get': (id: string) => UnitDetail;
  'unit:setTranslation': (id: string, target: string) => Issue[];
  'unit:setStatus': (id: string, status: TranslationStatus) => void;
  'unit:clear': (id: string) => void;
  'unit:acceptReview': (id: string) => Issue[];
  'unit:rejectReview': (id: string) => void;
  'unit:switchPastReview': (id: string) => Issue[];
  'unit:acceptReviews': (ids: string[]) => number;
  'unit:rejectReviews': (ids: string[]) => number;
  /** Translated sentences like this line's source, best first (the program measures it, no model call). */
  'similar:find': (id: string) => SimilarTranslation[];

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
  /** The whole instruction text of a kind, exactly as it is sent (for the guide screen). */
  'glossary:promptText': (kind: PromptKind) => string;
  /** Saves an edited instruction text; null puts the kind back on the default. */
  'glossary:setPromptText': (kind: PromptKind, text: string | null) => void;

  'job:draft': (mode?: DraftMode, choice?: DraftChoice) => void;
  'job:draftPlan': (mode: DraftMode, choice?: DraftChoice) => DraftPlan;
  'job:translate': (ids?: string[]) => void;
  'job:reviewPlan': (scope: ReviewScopeArg) => ReviewPlan;
  'job:review': (scope: ReviewScopeArg) => void;
  'job:decide': () => void;
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
  'app:claudeStatus': () => ClaudeStatus;
  'app:showItemInFolder': (file: string) => void;

  'decisions:groups': () => DecisionGroup[];
  'decisions:set': (key: string, d: DecisionInput) => void;
  'decisions:confirm': (keys?: string[]) => void;
  'decisions:clear': (key: string) => void;

  'exchange:export': (ids: string[]) => string | null;
  'exchange:planImport': () => ImportPlan | null;
  'exchange:applyImport': (overwrite: boolean) => { written: number };

  'preview:get': () => PreviewState;
  'preview:layout': (id: string, text?: string) => Layout | null;
  'preview:setFont': (path: string | null) => void;
  'preview:setOverrides': (o: Partial<WindowMetrics>) => void;
  /** Sets or clears the user's line width and line count of one window. */
  'preview:setWindow': (window: TextWindow, s: WindowSetting) => void;
  'preview:countOverflow': (path?: string | null) => OverflowCount;
  'preview:windowSkin': () => Uint8Array | null;
  'fonts:list': () => FontList;
  'fonts:bytes': (path: string) => Uint8Array;
  'fonts:pickFile': () => FontInfo | null;
  'story:scenes': (file: string) => SceneInfo[];

  'events:files': () => EventFileInfo[];
  'events:list': (file: string) => EventListInfo[];
  /** version: read an older version's copy instead of the current one. */
  'events:read': (file: string, listPath: PathSeg[], version?: string) => EventDetail;
  'events:usage': (target: UsageTarget) => EventRef[];
  'patches:list': () => PatchList;
  'patches:add': (p: NewPatch) => Patch;
  'patches:update': (id: string, p: PatchChange) => Patch;
  'patches:remove': (id: string) => void;
  'patches:setGameFont': (fontPath: string | null, subset: boolean) => void;
  'patches:setJosa': (enabled: boolean) => void;
  /** Enabled game plugins that may keep the particle plugin from working. */
  'patches:josaConflicts': () => string[];
  'patches:creatorReport': () => string;
  'patches:lastFontEmbed': () => FontEmbedInfo | null;
  'game:run': () => void;
  'game:stop': () => void;

  'images:list': () => ImageEntry[];
  'images:recipe': (file: string) => ImageRecipe | null;
  'images:thumb': (file: string, which: 'original' | 'rendered') => Uint8Array;
  'images:full': (file: string, which: 'original' | 'rendered') => Uint8Array | null;
  'images:setRecipe': (file: string, regions: ImageRegionInput[]) => ImageRecipe;
  'images:setStatus': (file: string, status: ImageStatus) => void;
  'images:pickManual': (file: string) => boolean;
  'images:clearManual': (file: string) => void;
  'images:acceptBase': (file: string) => void;
  'images:setDefaultFont': (path: string | null) => void;
  'images:rerenderAll': () => void;
  'images:defaultFont': () => string | null;
  'images:overflow': (file: string) => Record<string, RegionOverflow>;
  'images:failure': (file: string) => string | null;
  'images:folders': () => { folders: string[]; defaults: string[] };
  'images:setFolders': (folders: string[] | null) => void;
  /** Writes the decrypted original PNGs into a folder the user picks; null when cancelled. */
  'images:exportOriginals': (files: string[]) => { dir: string; written: number; failed: number } | null;
  'builds:list': () => BuildRecord[];
  'builds:setNotes': (number: number, text: string) => void;
  'builds:polishNotes': (number: number) => void;
  'builds:openFolder': (number: number) => void;

  'update:inspect': (gameDir: string) => UpdateInspect;
  'update:pickGameDir': () => string | null;
  'update:import': (gameDir: string, label: string) => UpdateSummary;
  'update:rollback': () => { restored: string };
  'update:summary': () => UpdateSummary | null;
  'update:versions': () => VersionInfo[];

  /** The action log of translation changes, newest first (without the changes themselves). */
  'history:list': () => ActionSummary[];
  /** Cancels one action: lines changed since stay as they are. */
  'history:cancel': (id: string) => CancelResult;
  /** Cancels every action newer than the given one. */
  'history:rollback': (id: string) => CancelResult;
  /** The changed lines of one action, at most 100 from offset, with the whole count. */
  'history:detail': (id: string, offset?: number, limit?: number) => ActionDetail;
}
export type InvokeChannel = keyof InvokeChannels;

// ---- window.api ----

type Async<F> = F extends (...a: infer A) => infer R ? (...a: A) => Promise<R> : never;
/** The window.api method for channel C. */
type Call<C extends InvokeChannel> = Async<InvokeChannels[C]>;

/** What the preload script puts on window.api: one group per channel prefix, plus on() for push events. */
export interface Api {
  settings: { get: Call<'settings:get'>; set: Call<'settings:set'> };
  project: {
    list: Call<'project:list'>; pickGameDir: Call<'project:pickGameDir'>;
    inspectGameDir: Call<'project:inspectGameDir'>; unpackGame: Call<'project:unpackGame'>;
    /** Path of a dropped file or folder (Electron webUtils; not an IPC call). */
    pathForDrop(file: File): string;
    create: Call<'project:create'>; open: Call<'project:open'>;
    close: Call<'project:close'>; snapshot: Call<'project:snapshot'>;
    undo: Call<'project:undo'>; build: Call<'project:build'>;
    setGameTitle: Call<'project:setGameTitle'>;
    rewrapPlan: Call<'project:rewrapPlan'>; rewrap: Call<'project:rewrap'>;
  };
  unit: {
    get: Call<'unit:get'>; setTranslation: Call<'unit:setTranslation'>;
    setStatus: Call<'unit:setStatus'>; clear: Call<'unit:clear'>;
    acceptReview: Call<'unit:acceptReview'>; rejectReview: Call<'unit:rejectReview'>; switchPastReview: Call<'unit:switchPastReview'>;
    acceptReviews: Call<'unit:acceptReviews'>; rejectReviews: Call<'unit:rejectReviews'>;
  };
  similar: { find: Call<'similar:find'> };
  chat: {
    send: Call<'chat:send'>; stop: Call<'chat:stop'>; reset: Call<'chat:reset'>;
    setModel: Call<'chat:setModel'>; undo: Call<'chat:undo'>;
  };
  glossary: {
    get: Call<'glossary:get'>; upsertTerm: Call<'glossary:upsertTerm'>;
    removeTerm: Call<'glossary:removeTerm'>; choose: Call<'glossary:choose'>;
    setCharacters: Call<'glossary:setCharacters'>; setStyleGuide: Call<'glossary:setStyleGuide'>;
    setRules: Call<'glossary:setRules'>; confirm: Call<'glossary:confirm'>;
    detectSpeakerPattern: Call<'glossary:detectSpeakerPattern'>; defaultStyleGuide: Call<'glossary:defaultStyleGuide'>;
    promptText: Call<'glossary:promptText'>; setPromptText: Call<'glossary:setPromptText'>;
  };
  job: {
    draft: Call<'job:draft'>; draftPlan: Call<'job:draftPlan'>; translate: Call<'job:translate'>;
    reviewPlan: Call<'job:reviewPlan'>; review: Call<'job:review'>;
    pause: Call<'job:pause'>; resume: Call<'job:resume'>; stop: Call<'job:stop'>;
    current: Call<'job:current'>;
    decide: Call<'job:decide'>;
  };
  app: { claudePath: Call<'app:claudePath'>; showItemInFolder: Call<'app:showItemInFolder'>; claudeStatus: Call<'app:claudeStatus'> };
  on<C extends PushChannel>(channel: C, cb: (payload: PushEvents[C]) => void): () => void;
  decisions: {
    groups: Call<'decisions:groups'>; set: Call<'decisions:set'>;
    confirm: Call<'decisions:confirm'>; clear: Call<'decisions:clear'>;
  };
  exchange: {
    export: Call<'exchange:export'>; planImport: Call<'exchange:planImport'>;
    applyImport: Call<'exchange:applyImport'>;
  };
  preview: {
    get: Call<'preview:get'>; layout: Call<'preview:layout'>;
    setFont: Call<'preview:setFont'>; setOverrides: Call<'preview:setOverrides'>;
    countOverflow: Call<'preview:countOverflow'>; windowSkin: Call<'preview:windowSkin'>;
    setWindow: Call<'preview:setWindow'>;
  };
  fonts: { list: Call<'fonts:list'>; bytes: Call<'fonts:bytes'>; pickFile: Call<'fonts:pickFile'> };
  story: { scenes: Call<'story:scenes'> };
  events: {
    files: Call<'events:files'>; list: Call<'events:list'>;
    read: Call<'events:read'>; usage: Call<'events:usage'>;
  };
  patches: {
    list: Call<'patches:list'>; add: Call<'patches:add'>;
    update: Call<'patches:update'>; remove: Call<'patches:remove'>;
    setGameFont: Call<'patches:setGameFont'>; creatorReport: Call<'patches:creatorReport'>;
    lastFontEmbed: Call<'patches:lastFontEmbed'>;
    setJosa: Call<'patches:setJosa'>; josaConflicts: Call<'patches:josaConflicts'>;
  };
  game: { run: Call<'game:run'>; stop: Call<'game:stop'> };
  images: {
    list: Call<'images:list'>; recipe: Call<'images:recipe'>;
    thumb: Call<'images:thumb'>; full: Call<'images:full'>;
    setRecipe: Call<'images:setRecipe'>; setStatus: Call<'images:setStatus'>;
    pickManual: Call<'images:pickManual'>; clearManual: Call<'images:clearManual'>;
    acceptBase: Call<'images:acceptBase'>; setDefaultFont: Call<'images:setDefaultFont'>;
    rerenderAll: Call<'images:rerenderAll'>; defaultFont: Call<'images:defaultFont'>;
    overflow: Call<'images:overflow'>; failure: Call<'images:failure'>;
    folders: Call<'images:folders'>; setFolders: Call<'images:setFolders'>;
    exportOriginals: Call<'images:exportOriginals'>;
  };
  builds: {
    list: Call<'builds:list'>; setNotes: Call<'builds:setNotes'>;
    polishNotes: Call<'builds:polishNotes'>; openFolder: Call<'builds:openFolder'>;
  };
  update: {
    inspect: Call<'update:inspect'>; pickGameDir: Call<'update:pickGameDir'>;
    import: Call<'update:import'>; rollback: Call<'update:rollback'>;
    summary: Call<'update:summary'>; versions: Call<'update:versions'>;
  };
  history: { list: Call<'history:list'>; cancel: Call<'history:cancel'>; rollback: Call<'history:rollback'>; detail: Call<'history:detail'> };
}
