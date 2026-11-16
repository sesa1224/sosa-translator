// Notation rules of the style guide that a program can see without reading the sentence for meaning. They run
// on every translation for free, so the reviewer model need not spend tokens on them, and translations made
// before a guide change get looked at again. All of them only warn: each has cases where the translator was right.
import { stripControlCodes } from '../text/controlCodes.js';
import type { Issue } from '../types.js';

const warn = (message: string): Issue => ({ rule: 'notation', severity: 'warning', message });

// Syllables a moan is made of. 읏 after one of these is part of the moan (으읏, 크으읏, 하읏); after any other
// syllable it is a small っ glued onto a word (있어읏, 안 돼읏), which the guide says to write as a stretched vowel.
const MOAN_SYLLABLES = new Set('아어으응하흐크큭큿히힛오우후헤흑끄읏앗엇핫흣훗웃옷앙항흥윽읍음흡흐햐꺄히잇');
const HANGUL_RUN = /[가-힣]+/g;

/** 읏 glued onto the end of a word instead of a stretched last vowel. */
export function gluedMoanIssue(target: string): Issue | null {
  for (const m of target.matchAll(HANGUL_RUN)) {
    const run = m[0];
    if (run.length < 2 || !run.endsWith('읏')) continue;
    const rest = [...run.slice(0, -1)];
    const afterWord = !MOAN_SYLLABLES.has(rest[rest.length - 1]);
    const inWord = rest.length >= 2 && !rest.every((ch) => MOAN_SYLLABLES.has(ch));
    if (afterWord || inWord) return warn(`'${run}': 말끝의 っ 는 읏을 붙이지 말고 끝 모음을 늘려 써요 (있어っ → 있어엇)`);
  }
  return null;
}

const MASK = '○〇×✕●＊';
const isMask = (ch: string | undefined): boolean => ch !== undefined && MASK.includes(ch);
// Kana (hiragana, katakana, the long mark) and kanji: a mask beside one of these hides a letter of a word.
const isJapaneseLetter = (ch: string | undefined): boolean => ch !== undefined && /[ぁ-ゖァ-ヺー一-鿿]/.test(ch);
const isHangul = (ch: string | undefined): boolean => ch !== undefined && /[가-힣]/.test(ch);

/**
 * A masked word (お○んこ) translated with the mask still in it. A run of masks (○○さん, ××年) is a name or a number
 * hidden on purpose and stays, so only a single mask beside a letter counts.
 */
export function maskIssue(source: string, target: string): Issue | null {
  const s = [...source];
  const maskedWord = s.some((ch, i) => isMask(ch) && !isMask(s[i - 1]) && !isMask(s[i + 1]) && (isJapaneseLetter(s[i - 1]) || isJapaneseLetter(s[i + 1])));
  if (!maskedWord) return null;
  const t = [...target];
  if (!t.some((ch, i) => isMask(ch) && (isHangul(t[i - 1]) || isHangul(t[i + 1])))) return null;
  return warn('가린 글자가 번역에 남아 있어요. 가리지 않은 낱말로 써요');
}

const ellipsisRuns = (s: string): number[] =>
  [...s.replace(/・・・/g, '…').replace(/\.\.\./g, '…').matchAll(/…+/g)].map((m) => m[0].length);

/**
 * One … in the source is …… in Korean, a longer one keeps its length. Compared run by run only when both texts have
 * as many runs: otherwise the sentence was rebuilt and the runs do not line up.
 */
export function ellipsisIssue(source: string, target: string): Issue | null {
  const src = ellipsisRuns(source);
  const dst = ellipsisRuns(target);
  if (src.length === 0 || src.length !== dst.length) return null;
  const want = src.map((n) => (n === 1 ? 2 : n));
  const at = want.findIndex((n, i) => dst[i] !== n);
  if (at < 0) return null;
  return warn(`말줄임표 길이가 달라요: ${'…'.repeat(want[at])} 로 써요 (지금 ${'…'.repeat(dst[at])})`);
}

const SYMBOL_KINDS: { label: string; chars: string }[] = [
  { label: '♥', chars: '♥❤♡' },
  { label: '♪', chars: '♪' },
  { label: '?', chars: '?？' },
  { label: '!', chars: '!！' },
  { label: '~', chars: '~～〜' },
];

/** Hearts, notes, ? ! and wave dashes counted per kind; a kind whose count changed is named. */
export function symbolCountIssue(source: string, target: string): Issue | null {
  // \! is a control code (wait for a key), not an exclamation mark.
  const src = stripControlCodes(source);
  const dst = stripControlCodes(target);
  const count = (s: string, chars: string) => [...s].filter((ch) => chars.includes(ch)).length;
  const off = SYMBOL_KINDS
    .map((k) => ({ label: k.label, from: count(src, k.chars), to: count(dst, k.chars) }))
    .filter((k) => k.from !== k.to);
  if (off.length === 0) return null;
  return warn(`기호 개수가 원문과 달라요: ${off.map((k) => `${k.label} ${k.from}→${k.to}`).join(', ')}`);
}

/** Full-width round brackets left in a translation while the project writes them half-width. */
export function roundBracketIssue(target: string): Issue | null {
  return /[（）]/.test(target) ? warn('전각 괄호 （ ）가 남아 있어요. ( ) 로 써요') : null;
}

/** unmask: the leftover-mask check; brackets: the half-width bracket rule is on. */
export interface NotationOptions { unmask: boolean; brackets: boolean }

/** Every notation warning for one translation. */
export function notationIssues(source: string, target: string, o: NotationOptions): Issue[] {
  const found = [
    gluedMoanIssue(target),
    o.unmask ? maskIssue(source, target) : null,
    ellipsisIssue(source, target),
    symbolCountIssue(source, target),
    o.brackets ? roundBracketIssue(target) : null,
  ];
  return found.filter((i): i is Issue => i !== null);
}
