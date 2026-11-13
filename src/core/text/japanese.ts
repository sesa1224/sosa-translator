/**
 * Hiragana letters, katakana letters, kana iteration marks, CJK ideographs
 * (ext. A + unified) and half-width katakana letters.
 *
 * Punctuation that lives in the kana blocks is left out on purpose: the middle
 * dot (U+30FB), the long-vowel mark (U+30FC) and their half-width forms show up
 * in text that is already translated, so they do not make a string Japanese.
 */
const JAPANESE =
  /[ぁ-ゖゝ-ゟァ-ヺヽ-ヿ㐀-鿿ｦ-ｯｱ-ﾝ]/;

/** True if s contains at least one Japanese character. */
export function hasJapanese(s: string): boolean {
  return JAPANESE.test(s);
}
