import type { TranslationStatus, UnitKind } from '../core/types.js';

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
