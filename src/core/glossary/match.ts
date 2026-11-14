import { stripControlCodes } from '../text/controlCodes.js';
import type { Issue } from '../types.js';
import type { Term } from './types.js';

/**
 * Terms whose source appears in text. Longer sources are matched first and a spot already taken by a
 * longer term is not matched again by a shorter one. In order of first appearance, no duplicates.
 */
export function termsIn(text: string, terms: Term[]): Term[] {
  const taken = new Uint8Array(text.length);
  const first = new Map<Term, number>();
  const sorted = terms.filter((t) => t.source !== '').sort((a, b) => b.source.length - a.source.length);
  for (const t of sorted) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(t.source, from);
      if (at < 0) break;
      const end = at + t.source.length;
      let free = true;
      for (let i = at; i < end; i++) if (taken[i]) { free = false; break; }
      if (free) {
        taken.fill(1, at, end);
        if (!first.has(t)) first.set(t, at);
        from = end;
      } else from = at + 1;
    }
  }
  return [...first.entries()].sort((a, b) => a[1] - b[1]).map(([t]) => t);
}

/** Terms enforced in running text: every term but those kept to the speaker's name. */
export function bodyTerms(terms: Term[]): Term[] {
  return terms.filter((t) => t.scope !== 'speaker');
}

/**
 * A warning for each speaker-only term that is the name in a speaker place (the speaker line of a message,
 * or a value that is nothing but the name, like the MZ name box) and whose translation is not in its place.
 * translated is the name as translated, compared whole: 선생님 is not 선생.
 */
export function checkSpeakerTerms(name: string, translated: string, terms: Term[]): Issue[] {
  const out: Issue[] = [];
  for (const t of terms) {
    if (t.scope !== 'speaker' || t.target === '' || t.source !== name || translated === t.target) continue;
    out.push({ rule: 'glossary', severity: 'warning', message: `화자 이름 "${t.source}"는 "${t.target}"(으)로 옮깁니다` });
  }
  return out;
}

/** A warning for each glossary term in source whose translation is missing from target. */
export function checkGlossary(source: string, target: string, terms: Term[]): Issue[] {
  const out: Issue[] = [];
  for (const t of termsIn(source, terms)) {
    if (t.target === '' || target.includes(t.target)) continue;
    out.push({ rule: 'glossary', severity: 'warning', message: `용어 "${t.source}"는 "${t.target}"(으)로 옮깁니다` });
  }
  return out;
}

const HALF_WIDTH = /[ -~｡-ﾟ]/;

/** Width of one line in full-width characters, after removing control codes. Half-width counts 0.5. */
export function lineWidthChars(line: string): number {
  let w = 0;
  for (const ch of stripControlCodes(line)) w += HALF_WIDTH.test(ch) ? 0.5 : 1;
  return w;
}
