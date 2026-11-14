import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { extractEvb, findPackedGame, readEvbTable } from '../../src/core/engine/evb.js';
import { compressed, currentContainer, fakeExe, legacyContainer, type Item } from '../helpers/evbPack.js';

// Sample executables from the evbunpack project's tests (Apache-2.0): a tiny app packed with one virtual file.
// Antivirus programs sometimes quarantine packed executables, so a sample that is gone is skipped, not failed.
const FIXTURES = path.join(__dirname, '..', 'fixtures', 'evb');
const ALL_SAMPLES: [string, boolean][] = [
  ['x86_PackerTestApp_packed_20170713.exe', true],
  ['x64_PackerTestApp_packed_20170713.exe', true],
  ['x86_PackerTestApp_packed_20210329.exe', false],
  ['x64_PackerTestApp_packed_20210329.exe', false],
  ['x86_PackerTestApp_packed_20240826.exe', false],
  ['x64_PackerTestApp_packed_20240826.exe', false],
];
const SAMPLES = ALL_SAMPLES.filter(([name]) => existsSync(path.join(FIXTURES, name)));

const dirs: string[] = [];
async function tmp(): Promise<string> {
  const d = await mkdtemp(path.join(os.tmpdir(), 'evb-'));
  dirs.push(d);
  return d;
}
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

const GAME: Item[] = [
  {
    name: '%DEFAULT FOLDER%',
    children: [
      { name: 'www', children: [
        { name: 'data', children: [{ name: 'System.json', data: Buffer.from('{"gameTitle":"テスト"}') }, { name: 'Empty.json', data: Buffer.alloc(0) }] },
        { name: 'js', children: [{ name: 'rpg_core.js', data: Buffer.from('// core') }] },
        { name: 'index.html', data: Buffer.from('<html></html>') },
      ] },
      { name: 'package.json', data: Buffer.from('{"name":"game"}') },
    ],
  },
];
const GAME_PATHS = ['www/data/System.json', 'www/data/Empty.json', 'www/js/rpg_core.js', 'www/index.html', 'package.json'];

describe('readEvbTable', () => {
  it.each(SAMPLES)('lists the packed file of %s', async (name, legacy) => {
    const table = await readEvbTable(path.join(FIXTURES, name));
    expect(table?.legacy).toBe(legacy);
    expect(table?.files.map((f) => [f.path, f.size, f.storedSize])).toEqual([['README.txt', 17, 17]]);
  });

  it('returns null for a file that is not a packed exe', async () => {
    const dir = await tmp();
    await writeFile(path.join(dir, 'a.exe'), Buffer.from('MZ not really'));
    await writeFile(path.join(dir, 'b.exe'), fakeExe(Buffer.alloc(0)).subarray(0, 0x200));
    expect(await readEvbTable(path.join(dir, 'a.exe'))).toBeNull();
    expect(await readEvbTable(path.join(dir, 'b.exe'))).toBeNull();
    expect(await readEvbTable(path.join(FIXTURES, 'README.txt'))).toBeNull();
  });

  it('puts nested folders in order, in both layouts', async () => {
    const dir = await tmp();
    for (const [file, bytes, legacy] of [['new.exe', currentContainer(GAME), false], ['old.exe', legacyContainer(GAME), true]] as const) {
      await writeFile(path.join(dir, file), fakeExe(bytes));
      const table = await readEvbTable(path.join(dir, file));
      expect(table?.legacy).toBe(legacy);
      expect(table?.files.map((f) => f.path)).toEqual(GAME_PATHS);
    }
  });

  it('refuses names that could leave the output folder', async () => {
    const dir = await tmp();
    for (const bad of ['..', 'a/b', 'a\\b', 'C:']) {
      await writeFile(path.join(dir, 'bad.exe'), fakeExe(currentContainer([{ name: bad, children: [{ name: 'x.txt', data: Buffer.from('x') }] }])));
      await expect(readEvbTable(path.join(dir, 'bad.exe'))).rejects.toThrow('파일 목록');
    }
  });

  it('refuses a table whose contents run past the end of the file', async () => {
    const dir = await tmp();
    const exe = fakeExe(currentContainer(GAME));
    await writeFile(path.join(dir, 'cut.exe'), exe.subarray(0, exe.length - 4));
    await expect(readEvbTable(path.join(dir, 'cut.exe'))).rejects.toThrow('파일 목록');
  });
});

describe('extractEvb', () => {
  it.each(SAMPLES)('writes the packed file of %s', async (name) => {
    const out = await tmp();
    expect(await extractEvb(path.join(FIXTURES, name), out)).toEqual({ files: 1, bytes: 17 });
    expect(await readFile(path.join(out, 'README.txt'), 'latin1')).toBe('Reading from EVB!');
  });

  it('writes a whole tree, in both layouts, and reports progress', async () => {
    const dir = await tmp();
    for (const [file, bytes] of [['new.exe', currentContainer(GAME)], ['old.exe', legacyContainer(GAME)]] as const) {
      await writeFile(path.join(dir, file), fakeExe(bytes));
      const out = path.join(dir, `${file}.out`);
      const seen: number[] = [];
      const r = await extractEvb(path.join(dir, file), out, { onProgress: (done) => seen.push(done) });
      expect(r.files).toBe(5);
      expect(seen[seen.length - 1]).toBe(r.bytes);
      expect(await readFile(path.join(out, 'www', 'data', 'System.json'), 'utf8')).toBe('{"gameTitle":"テスト"}');
      expect((await readFile(path.join(out, 'www', 'data', 'Empty.json'))).length).toBe(0);
      expect(await readFile(path.join(out, 'package.json'), 'utf8')).toBe('{"name":"game"}');
    }
  });

  it('expands compressed files chunk by chunk', async () => {
    const dir = await tmp();
    const data = Buffer.from(Array.from({ length: 1000 }, (_, i) => (i * 7) % 251));
    const items: Item[] = [{ name: '%DEFAULT FOLDER%', children: [
      { name: 'big.bin', data, stored: compressed(data, 300) },
      { name: 'after.txt', data: Buffer.from('still aligned') },
    ] }];
    await writeFile(path.join(dir, 'c.exe'), fakeExe(currentContainer(items)));
    const out = path.join(dir, 'out');
    await extractEvb(path.join(dir, 'c.exe'), out);
    expect((await readFile(path.join(out, 'big.bin'))).equals(data)).toBe(true);
    expect(await readFile(path.join(out, 'after.txt'), 'utf8')).toBe('still aligned');
  });

  it('refuses a file that is not a packed exe', async () => {
    const dir = await tmp();
    await expect(extractEvb(path.join(FIXTURES, 'README.txt'), dir)).rejects.toThrow('뭉친 exe 가 아닙니다');
  });
});

describe('findPackedGame', () => {
  it('finds the exe that packs a game and skips the others', async () => {
    const dir = await tmp();
    await writeFile(path.join(dir, 'a-tool.exe'), fakeExe(currentContainer([{ name: 'readme.txt', data: Buffer.from('tool') }])));
    await writeFile(path.join(dir, 'Game.exe'), fakeExe(currentContainer(GAME)));
    await writeFile(path.join(dir, 'broken.exe'), Buffer.from('MZ'));
    const found = await findPackedGame(dir);
    expect(found?.exe).toBe(path.join(dir, 'Game.exe'));
    expect(found?.files).toBe(5);
  });

  it('returns null when no exe packs a game', async () => {
    const dir = await tmp();
    await writeFile(path.join(dir, 'tool.exe'), fakeExe(legacyContainer([{ name: 'readme.txt', data: Buffer.from('tool') }])));
    expect(await findPackedGame(dir)).toBeNull();
  });
});
