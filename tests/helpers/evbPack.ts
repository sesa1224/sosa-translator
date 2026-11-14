// Builds small Enigma Virtual Box containers for tests: the same byte layout src/core/engine/evb.ts reads,
// wrapped in a minimal exe. Real packed samples are in tests/fixtures/evb.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const u32 = (...v: number[]): Buffer => {
  const b = Buffer.alloc(4 * v.length);
  v.forEach((x, i) => b.writeUInt32LE(x, i * 4));
  return b;
};
const name16 = (s: string): Buffer => Buffer.concat([Buffer.from(s, 'utf16le'), Buffer.alloc(2)]);

export type Item = { name: string; data: Buffer; stored?: Buffer } | { name: string; children: Item[] };

/** Literals only: valid aPLib that is longer than its input. */
function aplibLiterals(data: Buffer): Buffer {
  const out: number[] = [data[0]];
  const rest = [...data.subarray(1)];
  for (let i = 0; i < rest.length; i += 8) {
    const group = rest.slice(i, i + 8);
    // tag bits: one 0 per literal; when the group is short, the end marker 110 starts in the same tag
    if (group.length === 8) out.push(0x00, ...group);
    else {
      const endBits = [1, 1, 0].slice(0, 8 - group.length);
      let tag = 0;
      endBits.forEach((b, k) => { tag |= b << (7 - group.length - k); });
      out.push(tag, ...group);
      if (endBits.length < 3) {
        let tag2 = 0;
        [1, 1, 0].slice(endBits.length).forEach((b, k) => { tag2 |= b << (7 - k); });
        out.push(tag2);
      }
      out.push(0x00);
      return Buffer.from(out);
    }
  }
  out.push(0xc0, 0x00);
  return Buffer.from(out);
}

/** A file's stored bytes in compressed form: the chunk-size block, then the chunks. */
export function compressed(data: Buffer, chunkSize: number): Buffer {
  const chunks: Buffer[] = [];
  for (let i = 0; i < data.length; i += chunkSize) chunks.push(aplibLiterals(data.subarray(i, i + chunkSize)));
  const records = Buffer.concat(chunks.map((c, i) => (i === chunks.length - 1 ? u32(c.length) : u32(c.length, 0, 0))));
  return Buffer.concat([u32(8 + records.length, 0), records, ...chunks]);
}

/** A minimal PE whose .enigma1 section holds the container. */
export function fakeExe(container: Buffer): Buffer {
  const head = Buffer.alloc(0x200);
  head.write('MZ', 0, 'latin1');
  head.writeUInt32LE(0x80, 0x3c);
  head.write('PE\0\0', 0x80, 'latin1');
  head.writeUInt16LE(1, 0x86);
  head.writeUInt16LE(0, 0x94);
  const sec = 0x80 + 24;
  head.write('.enigma1', sec, 'latin1');
  // Decoy: the loader code has the magic as a constant before the real header.
  const section = Buffer.concat([Buffer.from('EVB\0\xff\xff\xff\xff', 'latin1'), container]);
  head.writeUInt32LE(section.length, sec + 16);
  head.writeUInt32LE(0x200, sec + 20);
  return Buffer.concat([head, section]);
}

function header(): Buffer {
  const h = Buffer.alloc(64);
  h.write('EVB\0', 0, 'latin1');
  h.writeUInt32LE(64, 4);
  return h;
}

export function currentContainer(items: Item[]): Buffer {
  const nodes: Buffer[] = [Buffer.concat([u32(0, 0, items.length), name16(''), Buffer.from([0])])];
  const contents: Buffer[] = [];
  const add = (it: Item): void => {
    if ('children' in it) {
      nodes.push(Buffer.concat([u32(1, 1, it.children.length), name16(it.name), Buffer.from([3]), Buffer.alloc(29)]));
      it.children.forEach(add);
    } else {
      const stored = it.stored ?? it.data;
      const extra = Buffer.alloc(57);
      extra.writeUInt32LE(it.data.length, 2);
      extra.writeUInt32LE(stored.length, 49);
      nodes.push(Buffer.concat([u32(2, 2, 0), name16(it.name), Buffer.from([2]), extra]));
      contents.push(stored);
    }
  };
  items.forEach(add);
  const table = Buffer.concat(nodes);
  return Buffer.concat([header(), u32(table.length), table, ...contents]);
}

export function legacyContainer(items: Item[]): Buffer {
  const parts: Buffer[] = [header()];
  const node = (b: Buffer): void => { parts.push(u32(b.length), b); };
  node(Buffer.concat([u32(0, 0, items.length), name16(''), Buffer.from([0])]));
  const add = (it: Item): void => {
    if ('children' in it) {
      node(Buffer.concat([u32(1, 1, it.children.length), name16(it.name), Buffer.from([3]), Buffer.alloc(29)]));
      it.children.forEach(add);
    } else {
      const extra = Buffer.alloc(49);
      extra.writeUInt32LE(it.data.length, 2);
      extra.writeUInt32LE(it.data.length, 41);
      node(Buffer.concat([u32(2, 2, 0), name16(it.name), Buffer.from([2]), extra]));
      parts.push(it.data);
    }
  };
  items.forEach(add);
  return Buffer.concat(parts);
}

/** The files of a folder as items under the "next to the exe" folder, ready for currentContainer or legacyContainer. */
export async function itemsFromDir(dir: string): Promise<Item[]> {
  const read = async (abs: string): Promise<Item[]> => {
    const out: Item[] = [];
    for (const e of (await readdir(abs, { withFileTypes: true })).sort((x, y) => x.name.localeCompare(y.name))) {
      if (e.isDirectory()) out.push({ name: e.name, children: await read(path.join(abs, e.name)) });
      else if (e.isFile()) out.push({ name: e.name, data: await readFile(path.join(abs, e.name)) });
    }
    return out;
  };
  return [{ name: '%DEFAULT FOLDER%', children: await read(dir) }];
}
