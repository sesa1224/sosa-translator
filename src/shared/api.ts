import type { Issue, ReviewNote, TranslationStatus, UnitKind } from '../core/types.js';

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
export type StatusFilter = 'all' | TranslationStatus | 'needs-decision' | 'provisional';
export interface RowQuery { text?: string; status?: StatusFilter; file?: string }
export interface Stats { total: number; untranslated: number; needsReview: number; approved: number; error: number; needsDecision: number; declined: number; provisional: number }
export interface Scope { file: string; label: string; total: number; done: number }   // done = rows with a target

export type Origin = 'user' | 'chat' | 'batch' | 'review';
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
export interface StageModels { glossary: string; translate: string; review: string; patchNotes: string }
export interface AppSettings { theme: 'dark' | 'light'; models: ModelOption[]; chatModel: string; claudePath: string | null; projectsDir: string; stageModels: StageModels }
export const DEFAULT_STAGE_MODELS: StageModels = { glossary: 'claude-fable-5-2', translate: 'claude-opus-5-5', review: 'claude-fable-5-2', patchNotes: 'claude-haiku-5-5' };

export type JobKind = 'draft' | 'translate' | 'review';
export type JobState = 'idle' | 'running' | 'paused' | 'paused-limit' | 'done' | 'failed' | 'stopped';
export interface JobProgress { kind: JobKind; state: JobState; done: number; total: number; label: string; usage: ChatUsage; declined: number; errors: number; message?: string }
export const DEFAULT_MODELS: ModelOption[] = [
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2' }, { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' }, { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' } ];

// ---- IPC (window.api) ----------------------------------------------------------------


export interface ProjectListItem { dir: string; name: string; engine: string }
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
export interface CharacterCard { id: string; source: string; target: string; speech: string; firstPerson?: string; addressing?: string }
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
}
export type PushChannel = keyof PushEvents;

/** Request/response channels. Arguments and results as seen by the renderer. */
export interface InvokeChannels {
  'settings:get': () => AppSettings;
  'settings:set': (patch: Partial<AppSettings>) => AppSettings;
  'project:list': () => ProjectListItem[];
  'project:pickGameDir': () => string | null;
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
  'job:draft': () => void;
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
    create: Async<InvokeChannels['project:create']>; open: Async<InvokeChannels['project:open']>;
    close: Async<InvokeChannels['project:close']>; snapshot: Async<InvokeChannels['project:snapshot']>;
    undo: Async<InvokeChannels['project:undo']>; build: Async<InvokeChannels['project:build']>;
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
    draft: Async<InvokeChannels['job:draft']>; translate: Async<InvokeChannels['job:translate']>;
    reviewPlan: Async<InvokeChannels['job:reviewPlan']>; review: Async<InvokeChannels['job:review']>;
    pause: Async<InvokeChannels['job:pause']>; resume: Async<InvokeChannels['job:resume']>; stop: Async<InvokeChannels['job:stop']>;
    current: Async<InvokeChannels['job:current']>;
  };
  app: { claudePath: Async<InvokeChannels['app:claudePath']>; showItemInFolder: Async<InvokeChannels['app:showItemInFolder']> };
  on<C extends PushChannel>(channel: C, cb: (payload: PushEvents[C]) => void): () => void;
}
