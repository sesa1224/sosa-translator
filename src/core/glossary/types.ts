import type { FormatRules } from '../check/rules.js';

export type TermCategory = 'name' | 'place' | 'term' | 'sfx' | 'other';
export type TermScope = 'speaker' | 'name';
export interface TermCandidate { target: string; reason: string }
export interface Term {
  id: string;                 // first 12 chars of sha1(source)
  source: string; target: string; category: TermCategory;
  status: 'confirmed' | 'provisional';   // provisional = going ahead with the recommended candidate
  candidates: TermCandidate[];           // 2-3 when provisional; candidates[0].target === target
  note?: string;
  /**
   * Where the translation is enforced. 'speaker': only where the term is the speaker's name (the speaker line, the name box), for a title like 先生 that others also use as a form of address.
   * 'name': only where the word is used as a name, for a name that is also an ordinary word; the models are told so, and the program checks it only in the speaker places (it cannot tell a name from a word in a sentence).
   * Missing = everywhere.
   */
  scope?: TermScope;
}
export interface CharacterCard { id: string; source: string; target: string; speech: string; firstPerson?: string; addressing?: string; moanStyle?: string }
export interface ProjectRules extends FormatRules {
  maxLineWidthChars: number | null;   // width in Korean characters (half-width counts 0.5); for dialogue the pixel check replaces it once a game font is set
  speakerPattern: string | null;      // regex source; the first group is the speaker name
  halfWidth: boolean;                 // machine translations get half-width punctuation, digits and Latin letters (text/width.ts)
  halfWidthBrackets: boolean;         // with halfWidth: （ ） become ( ) as well. Off in projects made before the rule, and for games whose plugins read the bracket
  notationCheck: boolean;             // the program warns about notation the style guide fixes (check/notation.ts)
  unmask: boolean;                    // with notationCheck: a masked word (お○んこ) must not keep its mask in the translation
}
/** Who the instruction text is for: the translate job, the review job, or an exported package. */
export type PromptKind = 'translate' | 'review' | 'export';
/** prompts: instruction texts the user edited, as templates (src/core/glossary/prompts.ts); a missing kind uses the default. */
export interface Glossary {
  terms: Term[]; characters: CharacterCard[]; styleGuide: string; rules: ProjectRules; confirmedAt: string | null;
  prompts?: Partial<Record<PromptKind, string>>;
}
