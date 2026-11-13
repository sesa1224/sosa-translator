export type Engine = 'MV' | 'MZ';

export interface GameInfo {
  engine: Engine;
  topDir: string;        // game top-level folder chosen by the user
  contentDir: string;    // folder holding data, js, img (topDir/www for MV deployments)
  contentPrefix: string; // '' or 'www/' (prepended to patch paths)
  encryptedImages: boolean;
  encryptionKey: string | null; // 32-char hex
}

export type UnitKind =
  | 'dialogue' | 'choice' | 'scroll' | 'name-change'
  | 'db' | 'system' | 'map-name'
  | 'plugin-param' | 'plugin-command' | 'script' | 'comment';

export type PathSeg = string | number | { key: string | number; json: true };

export type UnitRef =
  | { type: 'value'; file: string; path: PathSeg[] }                       // a single value
  | { type: 'lines'; file: string; listPath: PathSeg[]; start: number; count: number; code: 401 | 405 } // run of consecutive lines
  | { type: 'choice'; file: string; listPath: PathSeg[]; index: number; choice: number };              // n-th choice of a 102

export interface TextUnit {
  id: string;          // first 16 chars of sha1(kind + '\u0000' + (speaker ?? '') + '\u0000' + source)
  kind: UnitKind;
  source: string;      // line runs are joined with '\n'
  speaker?: string;
  needsDecision: boolean; // true for plugin-param, plugin-command, script, comment
  refs: UnitRef[];
}

export type TranslationStatus = 'untranslated' | 'needs-review' | 'approved' | 'error' | 'declined';
export interface ReviewNote { problem: string; suggestion: string; model: string }
export interface TranslationEntry {
  target: string | null; status: TranslationStatus; updatedAt: string;
  declinedReason?: string;   // why the model would not translate it (status 'declined')
  review?: ReviewNote;       // reviewer's open remark
  reviewedAt?: string;       // last time a review looked at it
}

export interface Issue { rule: 'control-codes' | 'leftover-japanese' | 'line-count' | 'empty' | 'glossary' | 'line-width' | 'line-width-px'; severity: 'error' | 'warning'; message: string }
export interface Warning { file: string; message: string }
