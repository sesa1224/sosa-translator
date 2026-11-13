import { readFile } from 'node:fs/promises';

/** Reads a UTF-8 JSON file, dropping a leading BOM. */
export async function readJsonFile(path: string): Promise<unknown> {
  let text = await readFile(path, 'utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return JSON.parse(text);
}
