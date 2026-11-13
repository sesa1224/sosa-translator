import type { Engine } from '../types.js';

/** 16-byte header of RPG Maker MV/MZ encrypted assets ("RPGMV" + version bytes). */
const HEADER = Uint8Array.from([0x52, 0x50, 0x47, 0x4d, 0x56, 0x00, 0x00, 0x00, 0x00, 0x03, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00]);
const HEADER_LEN = 16;

function keyBytes(keyHex: string): Uint8Array {
  if (!/^[0-9a-fA-F]{32}$/.test(keyHex)) throw new Error('암호화 키는 32자리 16진수여야 합니다');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) out[i] = parseInt(keyHex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function xorHead(body: Uint8Array, key: Uint8Array): void {
  const n = Math.min(16, body.length);
  for (let i = 0; i < n; i++) body[i] = body[i] ^ key[i];
}

/** Strips the RPG Maker header and un-XORs the first 16 body bytes. */
export function decryptAsset(data: Uint8Array, keyHex: string): Uint8Array {
  const key = keyBytes(keyHex);
  if (data.length < HEADER_LEN || !HEADER.every((b, i) => data[i] === b)) {
    throw new Error('RPG Maker 암호화 파일이 아닙니다');
  }
  const body = data.slice(HEADER_LEN);
  xorHead(body, key);
  return body;
}

/** Prepends the RPG Maker header and XORs the first 16 bytes with the key. */
export function encryptAsset(plain: Uint8Array, keyHex: string): Uint8Array {
  const key = keyBytes(keyHex);
  const out = new Uint8Array(HEADER_LEN + plain.length);
  out.set(HEADER, 0);
  out.set(plain, HEADER_LEN);
  xorHead(out.subarray(HEADER_LEN), key);
  return out;
}

const TO_PLAIN: Record<string, string> = {
  '.rpgmvp': '.png', '.rpgmvo': '.ogg', '.rpgmvm': '.m4a',
  '.png_': '.png', '.ogg_': '.ogg', '.m4a_': '.m4a',
};
const TO_MV: Record<string, string> = { '.png': '.rpgmvp', '.ogg': '.rpgmvo', '.m4a': '.rpgmvm' };

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i).toLowerCase();
}

/** Plain extension for an encrypted asset name, or null if it is not one. */
export function plainExtension(encryptedName: string): string | null {
  return TO_PLAIN[extOf(encryptedName)] ?? null;
}

/** Encrypted extension the engine uses for a plain asset name, or null if not encryptable. */
export function encryptedExtension(plainName: string, engine: Engine): string | null {
  const ext = extOf(plainName);
  if (!(ext in TO_MV)) return null;
  return engine === 'MV' ? TO_MV[ext] : `${ext}_`;
}
