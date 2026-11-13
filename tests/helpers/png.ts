import { deflateSync, inflateSync } from 'node:zlib';

const SIGNATURE = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/**
 * A w×h RGBA PNG. rgba is one colour for every pixel, a full RGBA buffer (w*h*4),
 * or a function giving the colour of each pixel.
 */
export function makePng(
  w: number,
  h: number,
  rgba: [number, number, number, number] | Uint8Array | ((x: number, y: number) => [number, number, number, number]) = [0, 0, 0, 255],
): Uint8Array {
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const at = row + 1 + x * 4;
      if (rgba instanceof Uint8Array) raw.set(rgba.subarray((y * w + x) * 4, (y * w + x) * 4 + 4), at);
      else raw.set(typeof rgba === 'function' ? rgba(x, y) : rgba, at);
    }
  }
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, w);
  v.setUint32(4, h);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', new Uint8Array(deflateSync(raw))), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export interface DecodedPng { width: number; height: number; data: Uint8Array; pixel(x: number, y: number): [number, number, number, number] }

/** Decodes an 8-bit RGBA or RGB PNG (any row filter) into RGBA pixels. */
export function readPng(png: Uint8Array): DecodedPng {
  if (!SIGNATURE.every((b, i) => png[i] === b)) throw new Error('not a PNG');
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let width = 0, height = 0, colorType = 6;
  const idat: Uint8Array[] = [];
  for (let at = 8; at < png.length;) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      width = view.getUint32(at + 8);
      height = view.getUint32(at + 12);
      if (data[8] !== 8) throw new Error('only 8-bit PNGs');
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!bpp) throw new Error(`unsupported colour type ${colorType}`);
  const joined = new Uint8Array(idat.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of idat) {
    joined.set(p, o);
    o += p.length;
  }
  const raw = new Uint8Array(inflateSync(joined));
  const stride = width * bpp;
  const cur = new Uint8Array(stride);
  const prev = new Uint8Array(stride);
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let pred = 0;
      if (filter === 1) pred = a;
      else if (filter === 2) pred = b;
      else if (filter === 3) pred = (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        pred = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[i] = (line[i] + pred) & 0xff;
    }
    for (let x = 0; x < width; x++) {
      const d = (y * width + x) * 4;
      data[d] = cur[x * bpp];
      data[d + 1] = cur[x * bpp + 1];
      data[d + 2] = cur[x * bpp + 2];
      data[d + 3] = bpp === 4 ? cur[x * bpp + 3] : 255;
    }
    prev.set(cur);
  }
  return {
    width, height, data,
    pixel: (x, y) => {
      const d = (y * width + x) * 4;
      return [data[d], data[d + 1], data[d + 2], data[d + 3]];
    },
  };
}
