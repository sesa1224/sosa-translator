import type { Issue, TranslationStatus, UnitKind } from '../core/types.js';

export interface Row {
  id: string; kind: UnitKind; speaker?: string; source: string;
  target: string | null; status: TranslationStatus; needsDecision: boolean;
  file: string;          // file of the first ref
  location: string;      // human-readable location, e.g. '맵4 · 이벤트3', 'Items · 1', '플러그인 설정'
  refCount: number;
}
export type StatusFilter = 'all' | TranslationStatus | 'needs-decision';
export interface RowQuery { text?: string; status?: StatusFilter; file?: string }
export interface Stats { total: number; untranslated: number; needsReview: number; approved: number; error: number; needsDecision: number }
export interface Scope { file: string; label: string; total: number; done: number }   // done = rows with a target

export type Origin = 'user' | 'chat';
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
export interface AppSettings { theme: 'dark' | 'light'; models: ModelOption[]; chatModel: string; claudePath: string | null; projectsDir: string }
export const DEFAULT_MODELS: ModelOption[] = [
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2' }, { id: 'claude-opus-5-5', label: 'Claude Opus 5.5' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' }, { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5' } ];

// ---- IPC (window.api) ----------------------------------------------------------------


export interface ProjectListItem { dir: string; name: string; engine: string }
export interface Snapshot { meta: ProjectMeta; gameTitle: string | null; rows: Row[]; stats: Stats; scopes: Scope[] }
export interface UnitDetail { row: Row; issues: Issue[]; refs: string[] }
export interface ProjectChanged { rows: Row[]; stats: Stats; scopes: Scope[]; origin: Origin }
export type { Issue };

// Copies of core types whose modules import node built-ins (the renderer cannot type-check those).
// src/main/ipc.ts checks at compile time that they still match the core ones.
export interface ProjectMeta {
  name: string; engine: 'MV' | 'MZ'; gameDir: string; contentPrefix: string; sourceLang: 'ja'; targetLang: 'ko';
  versions: { id: string; importedAt: string }[]; current: string;
}
export interface BuildResult { number: number; zipPath: string; files: { path: string; sha1: string }[]; skippedErrors: number }

/** Events the main process pushes to every window. */
export interface PushEvents {
  'project:changed': ProjectChanged;
  'chat:event': ChatEvent;
  'settings:changed': AppSettings;
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
  };
  chat: {
    send: Async<InvokeChannels['chat:send']>; stop: Async<InvokeChannels['chat:stop']>; reset: Async<InvokeChannels['chat:reset']>;
    setModel: Async<InvokeChannels['chat:setModel']>; undo: Async<InvokeChannels['chat:undo']>;
  };
  app: { claudePath: Async<InvokeChannels['app:claudePath']>; showItemInFolder: Async<InvokeChannels['app:showItemInFolder']> };
  on<C extends PushChannel>(channel: C, cb: (payload: PushEvents[C]) => void): () => void;
}
