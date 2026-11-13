/** Hiragana, katakana, CJK ideographs (ext. A + unified), half-width katakana. */
const JAPANESE = /[぀-ヿ㐀-鿿ｦ-ﾟ]/;

/** True if s contains at least one Japanese character. */
export function hasJapanese(s: string): boolean {
  return JAPANESE.test(s);
}
