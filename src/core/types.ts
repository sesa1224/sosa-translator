// The data model shared by every core module: what a translatable sentence is (TextUnit), where it sits in the
// game files (UnitRef), and what the translation table holds for it (TranslationEntry).

export type Engine = 'MV' | 'MZ';

/** What detectGame found in a game folder. */
export interface GameInfo {
  engine: Engine;
  topDir: string;        // game top-level folder chosen by the user
  contentDir: string;    // folder holding data, js, img (topDir/www for MV deployments)
  contentPrefix: string; // '' or 'www/' (prepended to patch paths)
  encryptedImages: boolean;
  encryptionKey: string | null; // 32-char hex
}

/** Where a sentence comes from. Kinds from plugin-param on are code-adjacent and start as needsDecision. */
export type UnitKind =
  | 'dialogue' | 'choice' | 'scroll' | 'name-change'
  | 'db' | 'system' | 'map-name'
  | 'plugin-param' | 'plugin-command' | 'script' | 'comment'
  | 'note' | 'plugin-js';

/**
 * One step into a JSON value. The object form steps into a value that is itself JSON text (plugin parameters
 * often hold JSON inside a string): the string is parsed, followed, and written back as a string.
 */
export type PathSeg = string | number | { key: string | number; json: true };

/** One place a sentence appears; applying a translation writes it back through each ref. */
export type UnitRef =
  | { type: 'value'; file: string; path: PathSeg[] }                       // a single value
  | { type: 'lines'; file: string; listPath: PathSeg[]; start: number; count: number; code: 401 | 405 } // run of consecutive lines
  | { type: 'choice'; file: string; listPath: PathSeg[]; index: number; choice: number }               // n-th choice of a 102
  | { type: 'note'; file: string; path: PathSeg[]; tag: string; index: number }                       // value of the index-th <tag:value> in a note
  | { type: 'js'; file: string; start: number; end: number; quote: '"' | "'" | '`' };            // inside of a string literal (UTF-16 offsets)

/**
 * One translatable sentence. The id is made from the text itself, not from its position: the same sentence in
 * many places is translated once, and re-extracting (after an extractor fix or a game update) gives the same
 * ids, so translations.json keeps working without a migration. A changed sentence gets a new id.
 */
export interface TextUnit {
  id: string;          // first 16 chars of sha1(kind + '\u0000' + (speaker ?? '') + '\u0000' + source)
  kind: UnitKind;
  source: string;      // line runs are joined with '\n'
  speaker?: string;
  needsDecision: boolean; // true for plugin-param, plugin-command, script, comment, note, plugin-js
  refs: UnitRef[];
  decisionKey?: string;   // groups needs-decision units judged together (src/core/decisions/keys.ts)
}

/**
 * translated: has a translation nobody raised a doubt about (where every new translation starts).
 * needs-review: someone should look: a reviewer's remark, a carried translation, an uncertain particle fix, or sent back by hand.
 * declined: the model would not translate it (declinedReason says why).
 */
export type TranslationStatus = 'untranslated' | 'translated' | 'needs-review' | 'approved' | 'error' | 'declined';
export interface ReviewNote { problem: string; suggestion: string; model: string }
/** A remark the user has dealt with: the translation it was about (before), and which of the two was taken. */
export interface PastReview extends ReviewNote { before: string; taken: 'suggestion' | 'before'; at: string }
/** One row of translations.json, keyed by TextUnit.id. */
export interface TranslationEntry {
  target: string | null; status: TranslationStatus; updatedAt: string;
  declinedReason?: string;   // why the model would not translate it (status 'declined')
  review?: ReviewNote;       // reviewer's open remark
  pastReview?: PastReview;   // the last remark that was taken or passed over; kept so the choice can be looked at again and turned around
  reviewedAt?: string;       // last time a review looked at it
  external?: true;           // came in from an outside translator's package
  previous?: { source: string; target: string | null; version: string };   // a changed sentence's source and translation in an older version
  carried?: true;            // the older translation was filled in (only punctuation or the speaker changed); waits for a look
  flagged?: true;            // put in 'needs-review' on purpose; tells it apart from the old default status of every translation
}

/** A problem the format check found in a translation. Errors keep it out of the build; warnings do not. */
export interface Issue { rule: 'control-codes' | 'leftover-japanese' | 'line-count' | 'empty' | 'glossary' | 'line-width' | 'line-width-px' | 'skeleton'; severity: 'error' | 'warning'; message: string }
/** A file the program could not read or use fully; the work goes on without it. */
export interface Warning { file: string; message: string }
