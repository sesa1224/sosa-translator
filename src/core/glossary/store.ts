import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { readJsonFile, writeJsonFile } from '../util/json.js';
import { DEFAULT_STYLE_GUIDE } from './defaultGuide.js';
import type { CharacterCard, Glossary, ProjectRules, Term, TermCategory } from './types.js';

export { DEFAULT_STYLE_GUIDE };
export const GLOSSARY_FILE = 'glossary.json';

export function termId(source: string): string {
  return createHash('sha1').update(source).digest('hex').slice(0, 12);
}

export function defaultRules(): ProjectRules {
  return { controlCodes: true, noLeftoverJapanese: true, sameLineCount: false, maxLines: 4, maxLineWidthChars: null, speakerPattern: null };
}

export function defaultGlossary(): Glossary {
  return { terms: [], characters: [], styleGuide: DEFAULT_STYLE_GUIDE, rules: defaultRules(), confirmedAt: null };
}

const CATEGORIES: TermCategory[] = ['name', 'place', 'term', 'sfx', 'other'];
const str = (v: unknown): v is string => typeof v === 'string';
const numOrNull = (v: unknown, d: number | null): number | null => (v === null ? null : typeof v === 'number' && Number.isFinite(v) ? v : d);
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : d);

function readTerm(v: any): Term | null {
  if (!v || typeof v !== 'object' || !str(v.source) || !v.source || !str(v.target)) return null;
  const candidates = Array.isArray(v.candidates)
    ? v.candidates.filter((c: any) => c && str(c.target)).map((c: any) => ({ target: c.target, reason: str(c.reason) ? c.reason : '' }))
    : [];
  const t: Term = {
    id: termId(v.source), source: v.source, target: v.target,
    category: CATEGORIES.includes(v.category) ? v.category : 'term',
    status: v.status === 'provisional' ? 'provisional' : 'confirmed',
    candidates,
  };
  if (str(v.note) && v.note) t.note = v.note;
  return t;
}

function readCharacter(v: any): CharacterCard | null {
  if (!v || typeof v !== 'object' || !str(v.source) || !v.source) return null;
  const c: CharacterCard = { id: str(v.id) && v.id ? v.id : termId(v.source), source: v.source, target: str(v.target) ? v.target : '', speech: str(v.speech) ? v.speech : '' };
  if (str(v.firstPerson) && v.firstPerson) c.firstPerson = v.firstPerson;
  if (str(v.addressing) && v.addressing) c.addressing = v.addressing;
  return c;
}

/** Fills missing or broken fields with the defaults. */
export function normalizeGlossary(raw: unknown): Glossary {
  const d = defaultGlossary();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as any;
  const rr = r.rules && typeof r.rules === 'object' ? r.rules : {};
  return {
    terms: Array.isArray(r.terms) ? r.terms.map(readTerm).filter((t: Term | null): t is Term => t !== null) : d.terms,
    characters: Array.isArray(r.characters) ? r.characters.map(readCharacter).filter((c: CharacterCard | null): c is CharacterCard => c !== null) : d.characters,
    styleGuide: str(r.styleGuide) ? r.styleGuide : d.styleGuide,
    rules: {
      controlCodes: bool(rr.controlCodes, d.rules.controlCodes),
      noLeftoverJapanese: bool(rr.noLeftoverJapanese, d.rules.noLeftoverJapanese),
      sameLineCount: bool(rr.sameLineCount, d.rules.sameLineCount),
      maxLines: numOrNull(rr.maxLines, d.rules.maxLines),
      maxLineWidthChars: numOrNull(rr.maxLineWidthChars, d.rules.maxLineWidthChars),
      speakerPattern: rr.speakerPattern === null ? null : str(rr.speakerPattern) && rr.speakerPattern ? rr.speakerPattern : d.rules.speakerPattern,
    },
    confirmedAt: str(r.confirmedAt) && r.confirmedAt ? r.confirmedAt : null,
  };
}

/** Reads <projectDir>/glossary.json; a missing file gives the default glossary. */
export async function loadGlossary(projectDir: string): Promise<Glossary> {
  const file = path.join(projectDir, GLOSSARY_FILE);
  if (!existsSync(file)) return defaultGlossary();
  return normalizeGlossary(await readJsonFile(file));
}

export async function saveGlossary(projectDir: string, g: Glossary): Promise<void> {
  await writeJsonFile(path.join(projectDir, GLOSSARY_FILE), g);
}
