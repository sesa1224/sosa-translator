import path from 'node:path';
import { createProject } from '../../src/core/project/project.js';
import { extractAll } from '../../src/core/extract/index.js';
import { TranslationStore } from '../../src/core/store/translations.js';
import type { Engine, TextUnit, TranslationStatus } from '../../src/core/types.js';
import { makeMiniGame } from './miniGame.js';
import { makeTempDir } from './fs.js';

export interface Fixture { game: string; proj: string; units: TextUnit[]; store: TranslationStore }

/** Mini game -> project '약초원' -> extractAll -> empty store. */
export async function setupProject(opts: { engine?: Engine; www?: boolean; name?: string } = {}): Promise<Fixture> {
  const game = await makeTempDir();
  const proj = path.join(await makeTempDir(), 'proj');
  await makeMiniGame(game, { engine: opts.engine, www: opts.www });
  await createProject(game, proj, opts.name ?? '약초원');
  const { units } = await extractAll(proj);
  const store = await TranslationStore.load(proj);
  return { game, proj, units, store };
}

/** Returns tr(source, target, status?) which finds the unit by source and stores the translation. */
export function translator(units: TextUnit[], store: TranslationStore) {
  return (source: string, target: string, status?: TranslationStatus) => {
    const u = units.find((x) => x.source === source);
    if (!u) throw new Error(`no unit with source ${source}`);
    store.set(u.id, target, status);
  };
}
