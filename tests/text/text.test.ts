import { expect, test } from 'vitest';
import { hasJapanese } from '../../src/core/text/japanese.js';
import { controlCodes } from '../../src/core/text/controlCodes.js';

test('일본어 판별', () => {
  expect(hasJapanese('月光草')).toBe(true); expect(hasJapanese('あれ')).toBe(true); expect(hasJapanese('ｶﾀｶﾅ')).toBe(true);
  expect(hasJapanese('Lv')).toBe(false); expect(hasJapanese('월광초 4')).toBe(false); expect(hasJapanese('')).toBe(false);
});
test('제어문자 뽑기', () => {
  expect(controlCodes('月光草を\\C[4]3本\\c[0]、\\V[12]G\\!\\.%1')).toEqual(['\\C[4]', '\\C[0]', '\\V[12]', '\\!', '\\.', '%1']);
  expect(controlCodes('\\{大きく\\}\\\\')).toEqual(['\\{', '\\}', '\\\\']);
  expect(controlCodes('ふつうの文')).toEqual([]);
});
