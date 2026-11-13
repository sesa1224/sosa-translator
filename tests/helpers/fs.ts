import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const created: string[] = [];

/** Creates a fresh empty temp directory; removed by cleanupTempDirs(). */
export async function makeTempDir(prefix = 'mvmz-'): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  created.push(dir);
  return dir;
}

export async function cleanupTempDirs(): Promise<void> {
  while (created.length) {
    await rm(created.pop()!, { recursive: true, force: true });
  }
}

/** Hash of every file path and content under dir, for "unchanged" checks. */
export async function hashDir(dir: string): Promise<string> {
  const h = createHash('sha1');
  const walk = async (d: string, rel: string): Promise<void> => {
    const entries = (await readdir(d, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name));
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(d, e.name), r);
      else {
        h.update(r + '\u0000');
        h.update(await readFile(path.join(d, e.name)));
        h.update('\u0000');
      }
    }
  };
  await walk(dir, '');
  return h.digest('hex');
}
