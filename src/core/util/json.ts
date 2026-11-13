import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Reads a UTF-8 JSON file, dropping a leading BOM. */
export async function readJsonFile(file: string): Promise<unknown> {
  let text = await readFile(file, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return JSON.parse(text);
}

/** Writes a project JSON file (UTF-8, 2-space indent) via a temp file so a crash never leaves it half-written. */
export async function writeJsonFile(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  await rename(tmp, file);
}
