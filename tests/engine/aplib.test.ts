import { describe, expect, it } from 'vitest';
import { aplibDepack } from '../../src/core/engine/aplib.js';

const text = (b: Uint8Array) => Buffer.from(b).toString('latin1');

describe('aplibDepack', () => {
  it('copies literals', () => {
    // 'a', tag 0b0110_0000: literal 'b', then the end marker (110 + offset byte 0)
    expect(text(aplibDepack(Uint8Array.from([0x61, 0x60, 0x62, 0x00]), 2))).toBe('ab');
  });

  it('expands a short match that overlaps its own output', () => {
    // 'a', tag 0b1101_1000: short match (offset 1, length 3), then the end marker
    expect(text(aplibDepack(Uint8Array.from([0x61, 0xd8, 0x03, 0x00]), 4))).toBe('aaaa');
  });

  it('expands a one-byte match and a zero byte', () => {
    // 'x', tag 0b1110_0011 0b1100_0011 0b0...: 111+0001 copies 'x'; 111+0000 writes 0; end marker
    // bits: 1 1 1 0 0 0 1 | 1 1 1 0 0 0 0 | 1 1 0
    // tag1 = 1110 0011 = 0xe3, tag2 = 1100 0011 = 0xc3, tag3 = 0000 0000... the end marker's last bit is in tag3
    expect([...aplibDepack(Uint8Array.from([0x78, 0xe3, 0xc3, 0x00, 0x00]), 3)]).toEqual([0x78, 0x78, 0x00]);
  });

  it('expands a normal match with a gamma-coded offset and length', () => {
    // 'a' 'b' as literals, then 10 + gamma(2 -> high part 0 after -2... see below) is avoided: use lwm=0 path.
    // After a literal (lwm=0) the high part is gamma-3: gamma(3)=bits 1,0 -> high 0, low byte 2 -> offset 2.
    // Length gamma(2)=bits 0,0; offset < 128 adds 2 -> 4 bytes: 'abab'.
    // bits: 0 (lit b) | 1 0 (match) | 1 0 (gamma 3) | 0 0 (gamma 2) | 1 1 0 (end)
    // tag1 = 0101 0001 = 0x51, tag2 = 10.. = 0x80
    const out = aplibDepack(Uint8Array.from([0x61, 0x51, 0x62, 0x02, 0x80, 0x00]), 6);
    expect(text(out)).toBe('ababab');
  });

  it('refuses output longer than the limit', () => {
    expect(() => aplibDepack(Uint8Array.from([0x61, 0x60, 0x62, 0x00]), 1)).toThrow();
    expect(() => aplibDepack(Uint8Array.from([0x61, 0xd8, 0x03, 0x00]), 3)).toThrow();
  });

  it('refuses a match that points before the start', () => {
    // short match with offset 5 right after the first byte
    expect(() => aplibDepack(Uint8Array.from([0x61, 0xc0, 0x0a, 0x00]), 3)).toThrow();
  });
});
