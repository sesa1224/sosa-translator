import { controlCodes } from './controlCodes.js';

// Brackets keep the source's own character (a line may open with （ and close with 」, and stays that way).
// ＼ and ％ would turn into the start of a control code or a placeholder.
const KEPT = new Set('（）［］｛｝＼％');
const FULL_WIDTH = /[！-～]/g;

/**
 * Full-width punctuation, digits and Latin letters (？ ！ ： ＋ １ Ａ) as their half-width forms, which is
 * how Korean text is written. The full-width space is left alone: games use it for indents.
 */
export function toHalfWidth(s: string): string {
  const out = s.replace(FULL_WIDTH, (ch) => (KEPT.has(ch) ? ch : String.fromCharCode(ch.charCodeAt(0) - 0xfee0)));
  // '%１' would become the placeholder '%1': a text whose codes would change is returned as it was.
  return controlCodes(out).join('\u0000') === controlCodes(s).join('\u0000') ? out : s;
}
