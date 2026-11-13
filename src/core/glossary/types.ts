import type { FormatRules } from '../check/rules.js';

export type TermCategory = 'name' | 'place' | 'term' | 'sfx' | 'other';
export interface TermCandidate { target: string; reason: string }
export interface Term {
  id: string;                 // first 12 chars of sha1(source)
  source: string; target: string; category: TermCategory;
  status: 'confirmed' | 'provisional';   // provisional = going ahead with the recommended candidate
  candidates: TermCandidate[];           // 2-3 when provisional; candidates[0].target === target
  note?: string;
}
export interface CharacterCard { id: string; source: string; target: string; speech: string; firstPerson?: string; addressing?: string; moanStyle?: string }
export interface ProjectRules extends FormatRules {
  maxLineWidthChars: number | null;   // width in Korean characters (half-width counts 0.5); for dialogue the pixel check replaces it once a game font is set
  speakerPattern: string | null;      // regex source; the first group is the speaker name
}
export interface Glossary { terms: Term[]; characters: CharacterCard[]; styleGuide: string; rules: ProjectRules; confirmedAt: string | null }
