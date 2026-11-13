import type { Decisions } from '../decisions/types.js';
import type { CharacterCard, Term } from '../glossary/types.js';
import { composeSpeaker, splitSpeaker } from '../text/speaker.js';
import type { TextUnit, TranslationEntry } from '../types.js';
import type { UnitDiff } from './types.js';

const EMPTY: TranslationEntry = { target: null, status: 'untranslated', updatedAt: '' };

/** Translated name of a speaker: a name term, else a character card, else the name itself. */
function speakerTarget(speaker: string, g: { terms: Term[]; characters: CharacterCard[] } | undefined): string {
  const term = g?.terms.find((t) => t.category === 'name' && t.source === speaker && t.target !== '');
  if (term) return term.target;
  const card = g?.characters.find((c) => c.source === speaker && c.target !== '');
  return card ? card.target : speaker;
}

/**
 * The old translation moved over to a sentence where only the speaker line changed (same body), with the speaker line
 * made again from the new source, or null when the change is more than that.
 */
function speakerOnly(oldU: TextUnit, newU: TextUnit, oldTarget: string, pattern: string | null, g: Parameters<typeof speakerTarget>[1]): string | null {
  if (oldU.kind !== 'dialogue' || newU.kind !== 'dialogue' || pattern === null) return null;
  const a = splitSpeaker(oldU.source, pattern);
  const b = splitSpeaker(newU.source, pattern);
  if (a.speakerLine === null || b.speakerLine === null || b.speaker === null || a.body !== b.body) return null;
  const nl = oldTarget.indexOf('\n');
  if (nl < 0) return null;
  return composeSpeaker(b.speakerLine, b.speaker, speakerTarget(b.speaker, g), oldTarget.slice(nl + 1));
}

/**
 * Carries translations over to a new version. Nothing given is changed: new objects come back.
 * Kept sentences need nothing (ids are the same). A changed sentence's new entry gets the old source and translation
 * as previous; when only punctuation or the speaker line changed, the old translation is also filled in as
 * 'needs-review' and marked carried. Removed sentences keep their entries (they come back if the sentence does).
 */
export function carryTranslations(o: {
  diff: UnitDiff; oldUnits: TextUnit[]; newUnits: TextUnit[];
  entries: Record<string, TranslationEntry>; decisions: Decisions; fromVersion: string; speakerPattern: string | null;
  /** For the translated speaker name when only the speaker line changed (missing = the source name). */
  glossary?: { terms: Term[]; characters: CharacterCard[] };
}): { entries: Record<string, TranslationEntry>; decisions: Decisions; carried: number } {
  const entries = structuredClone(o.entries);
  const decisions = structuredClone(o.decisions);
  const oldById = new Map(o.oldUnits.map((u) => [u.id, u]));
  const newById = new Map(o.newUnits.map((u) => [u.id, u]));
  const now = new Date().toISOString();
  let carried = 0;

  for (const c of o.diff.changed) {
    const oldU = oldById.get(c.oldId);
    const newU = newById.get(c.newId);
    if (!oldU || !newU) continue;
    const oldE = o.entries[c.oldId] ?? EMPTY;
    const cur = entries[c.newId] ?? { ...EMPTY, updatedAt: now };
    const next: TranslationEntry = { ...cur, previous: { source: oldU.source, target: oldE.target, version: o.fromVersion } };
    if (cur.target === null && oldE.target !== null) {
      const filled = c.punctuationOnly ? oldE.target : speakerOnly(oldU, newU, oldE.target, o.speakerPattern, o.glossary);
      if (filled !== null) {
        next.target = filled;
        next.status = 'needs-review';
        next.updatedAt = now;
        next.carried = true;
        delete next.declinedReason;
        carried++;
      }
    }
    entries[c.newId] = next;
  }

  for (const m of o.diff.moved) {
    const e = o.entries[m.oldId];
    if (e && !entries[m.newId]) entries[m.newId] = structuredClone(e);
    const d = o.decisions[`unit:${m.oldId}`];
    if (d && !decisions[`unit:${m.newId}`]) decisions[`unit:${m.newId}`] = structuredClone(d);
  }

  return { entries, decisions, carried };
}

export interface WordPiece { text: string; changed: boolean }

function merge(pieces: WordPiece[]): WordPiece[] {
  const out: WordPiece[] = [];
  for (const p of pieces) {
    const last = out[out.length - 1];
    if (last && last.changed === p.changed) last.text += p.text;
    else out.push({ ...p });
  }
  return out;
}

/** Longer texts are compared as a whole (all changed) to keep the table small. */
const MAX_LCS_CELLS = 4_000_000;

/** Pieces of the old and new source, marking the characters that differ (character LCS, neighbours of one kind merged). */
export function changedWords(oldSource: string, newSource: string): { old: WordPiece[]; new: WordPiece[] } {
  const a = [...oldSource];
  const b = [...newSource];
  if (a.length * b.length > MAX_LCS_CELLS) {
    return { old: a.length ? [{ text: oldSource, changed: true }] : [], new: b.length ? [{ text: newSource, changed: true }] : [] };
  }
  const w = b.length + 1;
  const t = new Uint32Array((a.length + 1) * w);
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      t[i * w + j] = a[i] === b[j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
    }
  }
  const oldP: WordPiece[] = [];
  const newP: WordPiece[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      oldP.push({ text: a[i++], changed: false });
      newP.push({ text: b[j++], changed: false });
    } else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) oldP.push({ text: a[i++], changed: true });
    else newP.push({ text: b[j++], changed: true });
  }
  while (i < a.length) oldP.push({ text: a[i++], changed: true });
  while (j < b.length) newP.push({ text: b[j++], changed: true });
  return { old: merge(oldP), new: merge(newP) };
}
