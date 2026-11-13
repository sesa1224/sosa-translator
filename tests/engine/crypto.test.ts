import { expect, test } from 'vitest';
import { decryptAsset, encryptAsset, encryptedExtension, plainExtension } from '../../src/core/engine/crypto.js';

const key = 'd41d8cd98f00b204e9800998ecf8427e';
const png = Uint8Array.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a, ...Array(40).fill(7)]);
test('암호화하고 풀면 원래대로', () => { expect(decryptAsset(encryptAsset(png, key), key)).toEqual(png); });
test('암호화 결과는 머리 16바이트가 붙고 16바이트 뒤는 그대로', () => {
  const e = encryptAsset(png, key);
  expect(e.length).toBe(png.length + 16); expect([...e.slice(0, 5)]).toEqual([0x52,0x50,0x47,0x4d,0x56]);
  expect(e.slice(32)).toEqual(png.slice(16)); expect(e[16]).toBe(0x89 ^ 0xd4);
});
test('머리가 다르면 오류', () => { expect(() => decryptAsset(png, key)).toThrow('RPG Maker 암호화 파일이 아닙니다'); });
test('확장자', () => {
  expect(plainExtension('a.rpgmvp')).toBe('.png'); expect(plainExtension('a.png_')).toBe('.png'); expect(plainExtension('a.png')).toBeNull();
  expect(encryptedExtension('a.png', 'MV')).toBe('.rpgmvp'); expect(encryptedExtension('a.png', 'MZ')).toBe('.png_');
});
