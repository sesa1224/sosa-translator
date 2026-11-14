// Reads the virtual file system of an exe packed with Enigma Virtual Box (a game shipped as one big exe) and
// writes its files out. Only reads the exe. The layout was worked out from published format notes and checked
// against sample executables; the exe itself (the wrapped program) is not restored, only the packed files.
//
// Layout, inside the PE section ".enigma1":
//   header (64 bytes, starts with "EVB\0"), then the file table, then the file contents.
//   A node is: u32, u32, u32 child count, UTF-16 name ending in 00 00, u8 type, then type-specific bytes.
//   Children follow their folder directly (depth first).
//   Current layout: one u32 table size, all nodes, then every file's content in table order.
//   Legacy layout (7.x and older): every node has its own u32 size in front and a file's content follows its node.
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, readdir, type FileHandle } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { aplibDepack } from './aplib.js';

/** One packed file. path is '/'-separated and relative to the folder the exe sits in. */
export interface EvbFile { path: string; size: number; storedSize: number; offset: number }
export interface EvbTable { legacy: boolean; files: EvbFile[] }

const MAGIC = Buffer.from('EVB\0', 'latin1');
const HEADER_SIZE = 64;
const SECTION = '.enigma1';
const TYPE_FILE = 2;
const TYPE_FOLDER = 3;
/** The folder that stands for "next to the exe". */
const DEFAULT_FOLDER = '%DEFAULT FOLDER%';
const FOLDER_EXTRA = 29;
// Bytes after a file node's type: total length and where the stored size sits. The original size is at +2 in both.
const FILE_EXTRA = { legacy: { length: 49, stored: 41 }, current: { length: 57, stored: 49 } };
/** The legacy main node: three u32, an empty name and the type byte. */
const LEGACY_MAIN_SIZE = 15;
const MAX_TABLE = 512 * 1024 * 1024;
const BAD_NAME = /[\\/:*?"<>|\u0000-\u001f]/;

function broken(): Error {
  return new Error('뭉친 exe 의 파일 목록을 읽을 수 없습니다');
}

async function readAt(fh: FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  const { bytesRead } = await fh.read(buf, 0, length, position);
  if (bytesRead !== length) throw broken();
  return buf;
}

/** File offset of the EVB header, or null when the file is not a packed exe. */
async function findContainer(fh: FileHandle): Promise<number | null> {
  const dos = Buffer.alloc(64);
  if ((await fh.read(dos, 0, 64, 0)).bytesRead !== 64 || dos.toString('latin1', 0, 2) !== 'MZ') return null;
  const pe = dos.readUInt32LE(0x3c);
  const head = Buffer.alloc(24);
  if ((await fh.read(head, 0, 24, pe)).bytesRead !== 24 || head.toString('latin1', 0, 4) !== 'PE\0\0') return null;
  const count = head.readUInt16LE(6);
  const sections = Buffer.alloc(count * 40);
  if ((await fh.read(sections, 0, sections.length, pe + 24 + head.readUInt16LE(20))).bytesRead !== sections.length) return null;
  for (let i = 0; i < count; i++) {
    const s = sections.subarray(i * 40, i * 40 + 40);
    if (s.toString('latin1', 0, 8).replace(/\0+$/, '') !== SECTION) continue;
    const rawSize = s.readUInt32LE(16);
    const rawAt = s.readUInt32LE(20);
    const data = Buffer.alloc(rawSize);
    const { bytesRead } = await fh.read(data, 0, rawSize, rawAt);
    // The loader's code holds the same four bytes as constants; the real header says its own length right after them.
    for (let at = data.indexOf(MAGIC); at >= 0 && at + 8 <= bytesRead; at = data.indexOf(MAGIC, at + 1)) {
      if (data.readUInt32LE(at + 4) === HEADER_SIZE) return rawAt + at;
    }
    return null;
  }
  return null;
}

interface Node { count: number; name: string; type: number; size: number; storedSize: number; end: number }

/** Parses the node at `at`. end: the offset right after it. */
function parseNode(buf: Buffer, at: number, legacy: boolean): Node {
  if (at + 12 > buf.length) throw broken();
  const count = buf.readUInt32LE(at + 8);
  let p = at + 12;
  const nameStart = p;
  for (;;) {
    if (p + 2 > buf.length) throw broken();
    if (buf.readUInt16LE(p) === 0) break;
    p += 2;
  }
  const name = buf.toString('utf16le', nameStart, p);
  p += 2;
  if (p + 1 > buf.length) throw broken();
  const type = buf[p++];
  let size = 0;
  let storedSize = 0;
  if (type === TYPE_FILE) {
    const extra = legacy ? FILE_EXTRA.legacy : FILE_EXTRA.current;
    if (p + extra.length > buf.length) throw broken();
    size = buf.readUInt32LE(p + 2);
    storedSize = buf.readUInt32LE(p + extra.stored);
    p += extra.length;
  } else if (type === TYPE_FOLDER) {
    if (p + FOLDER_EXTRA > buf.length) throw broken();
    p += FOLDER_EXTRA;
  }
  return { count, name, type, size, storedSize, end: p };
}

function childPath(parent: string, node: Node): string {
  if (node.type === TYPE_FOLDER && node.name === DEFAULT_FOLDER) return parent;
  // Names come from the exe: one that is not a plain file name could write outside the output folder.
  if (node.name === '' || node.name === '.' || node.name === '..' || BAD_NAME.test(node.name)) throw broken();
  return parent ? `${parent}/${node.name}` : node.name;
}

async function readCurrent(fh: FileHandle, tableAt: number): Promise<EvbFile[]> {
  const tableSize = (await readAt(fh, tableAt, 4)).readUInt32LE(0);
  if (tableSize > MAX_TABLE) throw broken();
  const buf = await readAt(fh, tableAt + 4, tableSize);
  const files: EvbFile[] = [];
  let at = 0;
  let offset = tableAt + 4 + tableSize;
  const walk = (parent: string): void => {
    const node = parseNode(buf, at, false);
    at = node.end;
    if (node.type === TYPE_FILE) {
      files.push({ path: childPath(parent, node), size: node.size, storedSize: node.storedSize, offset });
      offset += node.storedSize;
    } else if (node.type === TYPE_FOLDER) {
      const here = childPath(parent, node);
      for (let i = 0; i < node.count; i++) walk(here);
    } else throw broken();
  };
  const main = parseNode(buf, at, false);
  at = main.end;
  for (let i = 0; i < main.count; i++) walk('');
  return files;
}

async function readLegacy(fh: FileHandle, tableAt: number): Promise<EvbFile[]> {
  const files: EvbFile[] = [];
  let pos = tableAt;
  const next = async (): Promise<Node> => {
    const size = (await readAt(fh, pos, 4)).readUInt32LE(0);
    if (size > MAX_TABLE) throw broken();
    const node = parseNode(await readAt(fh, pos + 4, size), 0, true);
    if (node.end !== size) throw broken();
    pos += 4 + size;
    return node;
  };
  const walk = async (parent: string): Promise<void> => {
    const node = await next();
    if (node.type === TYPE_FILE) {
      files.push({ path: childPath(parent, node), size: node.size, storedSize: node.storedSize, offset: pos });
      pos += node.storedSize;
    } else if (node.type === TYPE_FOLDER) {
      const here = childPath(parent, node);
      for (let i = 0; i < node.count; i++) await walk(here);
    } else throw broken();
  };
  const main = await next();
  for (let i = 0; i < main.count; i++) await walk('');
  return files;
}

/** The files packed into an Enigma Virtual Box exe, or null when the file is not one. Reads only. */
export async function readEvbTable(file: string): Promise<EvbTable | null> {
  const fh = await open(file, 'r');
  try {
    const at = await findContainer(fh);
    if (at === null) return null;
    const tableAt = at + HEADER_SIZE;
    // Only the legacy layout starts with a node size, and that first node (the nameless root) is always 15 bytes.
    // In the current layout the same field is the whole table's size, which is 15 only for an empty table.
    const first = await readAt(fh, tableAt, 4 + LEGACY_MAIN_SIZE);
    const legacy = first.readUInt32LE(0) === LEGACY_MAIN_SIZE && first.readUInt32LE(12) > 0;
    const files = legacy ? await readLegacy(fh, tableAt) : await readCurrent(fh, tableAt);
    const { size } = await fh.stat();
    if (files.some((f) => f.offset + f.storedSize > size)) throw broken();
    return { legacy, files };
  } finally {
    await fh.close();
  }
}

/** Writes one compressed file: a block of chunk sizes, then the chunks, each its own aPLib stream. */
async function writeCompressed(fh: FileHandle, f: EvbFile, dst: string): Promise<void> {
  const blockSize = (await readAt(fh, f.offset, 4)).readUInt32LE(0);
  if (blockSize < 8 || blockSize > f.storedSize) throw broken();
  const table = await readAt(fh, f.offset + 8, blockSize - 8);
  // Records are (compressed size, two more u32); the last record may be cut short after its first field.
  const chunks: number[] = [];
  for (let i = 0; i + 4 <= table.length; i += 12) chunks.push(table.readUInt32LE(i));
  if (chunks.reduce((a, b) => a + b, 0) !== f.storedSize - blockSize) throw broken();
  const out = await open(dst, 'w');
  try {
    let pos = f.offset + blockSize;
    let written = 0;
    for (const size of chunks) {
      const plain = aplibDepack(await readAt(fh, pos, size), f.size - written);
      await out.write(plain);
      pos += size;
      written += plain.length;
    }
    if (written !== f.size) throw broken();
  } finally {
    await out.close();
  }
}

export interface EvbExtractOptions { onProgress?(doneBytes: number, totalBytes: number): void }

/** Writes every packed file under outDir. Returns how many files and bytes were written. Reads the exe only. */
export async function extractEvb(file: string, outDir: string, o: EvbExtractOptions = {}): Promise<{ files: number; bytes: number }> {
  const table = await readEvbTable(file);
  if (!table) throw new Error('Enigma Virtual Box 로 뭉친 exe 가 아닙니다');
  const root = path.resolve(outDir);
  const total = table.files.reduce((a, f) => a + f.size, 0);
  let done = 0;
  const fh = await open(file, 'r');
  try {
    for (const f of table.files) {
      const dst = path.resolve(root, ...f.path.split('/'));
      if (!dst.startsWith(root + path.sep)) throw broken();
      await mkdir(path.dirname(dst), { recursive: true });
      if (f.size !== f.storedSize) await writeCompressed(fh, f, dst);
      else if (f.size === 0) await (await open(dst, 'w')).close();
      else await pipeline(createReadStream(file, { start: f.offset, end: f.offset + f.size - 1 }), createWriteStream(dst));
      done += f.size;
      o.onProgress?.(done, total);
    }
  } finally {
    await fh.close();
  }
  return { files: table.files.length, bytes: total };
}

export interface PackedGame { exe: string; files: number; bytes: number }

/** An exe directly in dir that packs an MV/MZ game (it holds data/System.json), or null. Reads only. */
export async function findPackedGame(dir: string): Promise<PackedGame | null> {
  const names = (await readdir(dir, { withFileTypes: true })).filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.exe')).map((e) => e.name).sort();
  for (const name of names) {
    const exe = path.join(dir, name);
    let table: EvbTable | null;
    try {
      table = await readEvbTable(exe);
    } catch {
      continue;
    }
    if (table?.files.some((f) => /(^|\/)data\/System\.json$/i.test(f.path))) {
      return { exe, files: table.files.length, bytes: table.files.reduce((a, f) => a + f.size, 0) };
    }
  }
  return null;
}
