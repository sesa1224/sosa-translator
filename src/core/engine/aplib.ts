// Decompressor for aPLib streams, the scheme Enigma Virtual Box uses for compressed virtual files.
// Written from the published description of the format: a first literal byte, then tag bits (most significant
// first) choosing between a literal, a normal match, a short match and a one-byte match.

function corrupt(): Error {
  return new Error('압축된 내용이 손상됐습니다');
}

/** Decompresses one aPLib stream. limit: the most bytes it may produce; a stream that wants more throws. */
export function aplibDepack(src: Uint8Array, limit: number): Uint8Array {
  // The stream does not say how long its output is, so the buffer grows up to the limit.
  let out = new Uint8Array(Math.min(limit, Math.max(64 * 1024, src.length * 4)));
  const room = (need: number): void => {
    if (need > limit) throw corrupt();
    if (need <= out.length) return;
    const grown = new Uint8Array(Math.min(limit, Math.max(need, out.length * 2)));
    grown.set(out.subarray(0, dp));
    out = grown;
  };
  let sp = 0;
  let dp = 0;
  let tag = 0;
  let bitsLeft = 0;

  const byte = (): number => {
    if (sp >= src.length) throw corrupt();
    return src[sp++];
  };
  const bit = (): number => {
    if (bitsLeft === 0) {
      tag = byte();
      bitsLeft = 8;
    }
    bitsLeft--;
    const b = (tag >> 7) & 1;
    tag = (tag << 1) & 0xff;
    return b;
  };
  const gamma = (): number => {
    let v = 1;
    do {
      v = v * 2 + bit();
      if (v > 0x7fffffff) throw corrupt();
    } while (bit());
    return v;
  };
  const put = (b: number): void => {
    room(dp + 1);
    out[dp++] = b;
  };
  const copy = (offset: number, length: number): void => {
    if (offset <= 0 || offset > dp) throw corrupt();
    room(dp + length);
    // Byte by byte: a match may overlap the bytes it is producing.
    for (let i = 0; i < length; i++, dp++) out[dp] = out[dp - offset];
  };

  put(byte());
  let lastOffset = 0;
  // Whether the previous step was a match; it changes how the next normal match codes its offset.
  let afterMatch = false;
  for (;;) {
    if (!bit()) {
      put(byte());
      afterMatch = false;
      continue;
    }
    if (!bit()) {
      let high = gamma();
      if (!afterMatch && high === 2) {
        copy(lastOffset, gamma());
      } else {
        high -= afterMatch ? 2 : 3;
        if (high < 0) throw corrupt();
        const offset = high * 256 + byte();
        let length = gamma();
        if (offset >= 32000) length++;
        if (offset >= 1280) length++;
        if (offset < 128) length += 2;
        copy(offset, length);
        lastOffset = offset;
      }
      afterMatch = true;
      continue;
    }
    if (!bit()) {
      const b = byte();
      const offset = b >> 1;
      if (offset === 0) break;
      copy(offset, 2 + (b & 1));
      lastOffset = offset;
      afterMatch = true;
      continue;
    }
    let offset = 0;
    for (let i = 0; i < 4; i++) offset = offset * 2 + bit();
    if (offset === 0) put(0);
    else copy(offset, 1);
    afterMatch = false;
  }
  return out.subarray(0, dp);
}
