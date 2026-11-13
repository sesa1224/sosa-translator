const HANGUL_FIRST = 0xac00;
const HANGUL_LAST = 0xd7a3;
const RIEUL = 8; // index of the ㄹ final consonant

function finalIndex(word: string): number | null {
  const last = [...word].at(-1);
  if (last === undefined) return null;
  const code = last.codePointAt(0)!;
  if (code < HANGUL_FIRST || code > HANGUL_LAST) return null;
  return (code - HANGUL_FIRST) % 28;
}

/** Whether the last syllable has a final consonant. null when the last character is not a Hangul syllable. */
export function hasFinalConsonant(word: string): boolean | null {
  const i = finalIndex(word);
  return i === null ? null : i !== 0;
}

/** Particle pairs: [after a final consonant, after a vowel]. */
const PAIRS: [string, string][] = [
  ['을', '를'], ['이', '가'], ['은', '는'], ['과', '와'], ['으로', '로'],
  ['아', '야'], ['이랑', '랑'], ['이나', '나'], ['이라', '라'], ['이야', '야'],
];
/** Every particle form, longest first. */
const FORMS = [...new Set(PAIRS.flat())].sort((a, b) => b.length - a.length);

function isBoundary(ch: string | undefined): boolean {
  return ch === undefined || !/[\p{L}\p{N}]/u.test(ch);
}

/**
 * Fixes the particle right after `word` (which ends at wordEnd) to match the word's final consonant.
 * Text with no particle there is left as is (certain). certain is false when a letter follows the
 * particle-like part (it may be another word), when the word does not end in Hangul, or when the
 * particle could be either of two pairs.
 */
export function fixJosa(text: string, wordEnd: number, word: string): { text: string; certain: boolean } {
  const rest = text.slice(wordEnd);
  const starts = FORMS.filter((f) => rest.startsWith(f));
  if (starts.length === 0) return { text, certain: true };
  const form = starts.find((f) => isBoundary(rest[f.length]));
  if (form === undefined) return { text, certain: false };
  const fin = finalIndex(word);
  if (fin === null) return { text, certain: false };
  const hasFinal = fin !== 0;
  const choices = new Set<string>();
  for (const [withFinal, withoutFinal] of PAIRS) {
    if (form !== withFinal && form !== withoutFinal) continue;
    if (withFinal === '으로') choices.add(hasFinal && fin !== RIEUL ? withFinal : withoutFinal);
    else choices.add(hasFinal ? withFinal : withoutFinal);
  }
  if (choices.size !== 1) return { text, certain: false };
  const right = [...choices][0];
  return { text: text.slice(0, wordEnd) + right + rest.slice(form.length), certain: true };
}
