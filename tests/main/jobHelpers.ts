import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { JsonCallResult } from '../../src/main/claude/json.js';
import type { ChatUsage, JobProgress } from '../../src/shared/api.js';
import { makeTempDir } from '../helpers/fs.js';
import { makeMiniGame } from '../helpers/miniGame.js';

export const zero: ChatUsage = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };
export const someUsage: ChatUsage = { input: 10, output: 5, cacheRead: 0, cacheCreate: 0 };

/** The mini game plus an MV-style message whose first line is the speaker: 【アーテル】 / 「え？」. */
export async function speakerGame(): Promise<{ game: string; proj: string }> {
  const game = await makeTempDir();
  await makeMiniGame(game);
  const file = path.join(game, 'data', 'Map001.json');
  const map = JSON.parse(await readFile(file, 'utf8'));
  const list: unknown[] = map.events[1].pages[0].list;
  list.splice(list.length - 1, 0,
    { code: 101, indent: 0, parameters: ['', 0, 0, 2, ''] },
    { code: 401, indent: 0, parameters: ['【アーテル】'] },
    { code: 401, indent: 0, parameters: ['「え？」'] });
  await writeFile(file, JSON.stringify(map), 'utf8');
  const proj = path.join(await makeTempDir(), 'proj');
  return { game, proj };
}

type CallOpts = { user: string; model: string; signal?: AbortSignal };
export type FakeCall = (o: CallOpts) => Promise<JsonCallResult<any>>;

/** A fake call that answers with fn(parsed user JSON). */
export function answer(fn: (u: any) => unknown): FakeCall {
  return async (o) => ({ ok: true, data: fn(JSON.parse(o.user)), usage: { ...someUsage } });
}

const CODE = /\\[A-Za-z]+(?:\[[^\]\r\n]*\])?|\\[{}.|!><^$\\]|%\d+/g;

/** Answers every item with a valid translation: '번역' plus the item's control codes. */
export function okAll(o: CallOpts): Promise<JsonCallResult<any>> {
  const u = JSON.parse(o.user);
  return Promise.resolve({ ok: true, data: { items: u.items.map((x: any) => ({ i: x.i, t: '번역' + (x.text.match(CODE) ?? []).join('') })) }, usage: { ...someUsage } });
}

/** Wraps a call so it takes 500 ms and gives 'aborted' when the signal fires. */
export function slow(fn: FakeCall): FakeCall {
  return (o) => new Promise((resolve) => {
    const t = setTimeout(() => resolve(fn(o)), 500);
    o.signal?.addEventListener('abort', () => { clearTimeout(t); resolve({ ok: false, kind: 'aborted', message: '', usage: { ...zero } }); });
  });
}

/** Resolves when the job leaves 'running'. */
export function idle(job: { progress: JobProgress; on(e: 'progress', l: (p: JobProgress) => void): unknown; off(e: 'progress', l: (p: JobProgress) => void): unknown }): Promise<void> {
  return new Promise((resolve) => {
    if (job.progress.state !== 'running') return resolve();
    const l = (p: JobProgress) => {
      if (p.state === 'running') return;
      job.off('progress', l);
      resolve();
    };
    job.on('progress', l);
  });
}
