import path from 'node:path';
import type { TextUnit } from '../../src/core/types.js';
import { makeTempDir } from '../helpers/fs.js';
import { makeMiniGame } from '../helpers/miniGame.js';

/** A fresh mini game folder and a not-yet-existing project folder path. */
export async function freshGame(): Promise<{ game: string; proj: string }> {
  const game = await makeTempDir();
  await makeMiniGame(game);
  const proj = path.join(await makeTempDir(), 'proj');
  return { game, proj };
}

/** Returns idOf(source) that finds the unit id with that source. */
export function idFinder(units: () => TextUnit[]) {
  return (source: string): string => {
    const u = units().find((x) => x.source === source);
    if (!u) throw new Error(`no unit with source ${source}`);
    return u.id;
  };
}
