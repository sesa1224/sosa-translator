import type { TextUnit, TranslationEntry } from '../types.js';
import { fixJosa } from './josa.js';
import type { Term } from './types.js';

/**
 * New translations for every translated unit whose source holds the term and whose translation holds
 * the current target: each occurrence is replaced and the particle after it fixed.
 * certain is false when any particle could not be fixed with confidence.
 */
export function planRename(
  term: Term,
  newTarget: string,
  units: TextUnit[],
  entryOf: (id: string) => TranslationEntry,
): { id: string; newTarget: string; certain: boolean }[] {
  const out: { id: string; newTarget: string; certain: boolean }[] = [];
  if (term.target === '' || term.target === newTarget) return out;
  for (const u of units) {
    if (!u.source.includes(term.source)) continue;
    const target = entryOf(u.id).target;
    if (target === null || !target.includes(term.target)) continue;
    let text = target;
    let certain = true;
    let from = 0;
    for (;;) {
      const at = text.indexOf(term.target, from);
      if (at < 0) break;
      text = text.slice(0, at) + newTarget + text.slice(at + term.target.length);
      const end = at + newTarget.length;
      const fixed = fixJosa(text, end, newTarget);
      text = fixed.text;
      certain &&= fixed.certain;
      from = end;
    }
    out.push({ id: u.id, newTarget: text, certain });
  }
  return out;
}
