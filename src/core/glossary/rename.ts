import { splitSpeaker } from '../text/speaker.js';
import type { TextUnit, TranslationEntry } from '../types.js';
import { fixJosa } from './josa.js';
import type { Term } from './types.js';

/** Replaces every oldTarget in text and fixes the particle after each. */
function replaceAll(text: string, oldTarget: string, newTarget: string): { text: string; certain: boolean } {
  let certain = true;
  let from = 0;
  for (;;) {
    const at = text.indexOf(oldTarget, from);
    if (at < 0) break;
    text = text.slice(0, at) + newTarget + text.slice(at + oldTarget.length);
    const end = at + newTarget.length;
    const fixed = fixJosa(text, end, newTarget);
    text = fixed.text;
    certain &&= fixed.certain;
    from = end;
  }
  return { text, certain };
}

/**
 * New translations for every translated unit whose source holds the term and whose translation holds
 * the current target: each occurrence is replaced and the particle after it fixed.
 * certain is false when any particle could not be fixed with confidence.
 *
 * A speaker-only term changes only where it is the speaker's name: the speaker line of a message and a
 * value that is nothing but the name. The same word used as a form of address in the text is left alone.
 */
export function planRename(
  term: Term,
  newTarget: string,
  units: TextUnit[],
  entryOf: (id: string) => TranslationEntry,
  speakerPattern: string | null = null,
): { id: string; newTarget: string; certain: boolean }[] {
  const out: { id: string; newTarget: string; certain: boolean }[] = [];
  if (term.target === '' || term.target === newTarget) return out;
  for (const u of units) {
    if (!u.source.includes(term.source)) continue;
    const target = entryOf(u.id).target;
    if (target === null || !target.includes(term.target)) continue;
    if (term.scope !== 'speaker') {
      const r = replaceAll(target, term.target, newTarget);
      out.push({ id: u.id, newTarget: r.text, certain: r.certain });
      continue;
    }
    if (u.kind === 'dialogue') {
      if (splitSpeaker(u.source, speakerPattern).speaker !== term.source) continue;
      const nl = target.indexOf('\n');
      const first = nl < 0 ? target : target.slice(0, nl);
      // Compared whole: a line already reading 선생님 is not a use of 선생.
      if (splitSpeaker(target, speakerPattern).speaker !== term.target) continue;
      const r = replaceAll(first, term.target, newTarget);
      out.push({ id: u.id, newTarget: r.text + (nl < 0 ? '' : target.slice(nl)), certain: r.certain });
    } else if (u.source.trim() === term.source && target.trim() === term.target) {
      const r = replaceAll(target, term.target, newTarget);
      out.push({ id: u.id, newTarget: r.text, certain: r.certain });
    }
  }
  return out;
}
