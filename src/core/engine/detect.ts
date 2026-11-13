import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Engine, GameInfo } from '../types.js';
import { readJsonFile } from '../util/json.js';

function notGame(reason: string): Error {
  return new Error(`MV/MZ 게임이 아닙니다: ${reason}`);
}

/** Detects an RPG Maker MV/MZ game in topDir. Never writes anything. */
export async function detectGame(topDir: string): Promise<GameInfo> {
  const www = path.join(topDir, 'www');
  const useWww = existsSync(path.join(www, 'data', 'System.json'));
  const contentDir = useWww ? www : topDir;
  const contentPrefix = useWww ? 'www/' : '';

  let engine: Engine;
  if (existsSync(path.join(contentDir, 'js', 'rmmz_core.js'))) engine = 'MZ';
  else if (existsSync(path.join(contentDir, 'js', 'rpg_core.js'))) engine = 'MV';
  else throw notGame('js/rmmz_core.js 와 js/rpg_core.js 가 모두 없습니다');

  const systemPath = path.join(contentDir, 'data', 'System.json');
  if (!existsSync(systemPath)) throw notGame('data/System.json 이 없습니다');
  let system: Record<string, unknown>;
  try {
    const json = await readJsonFile(systemPath);
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new Error('not an object');
    system = json as Record<string, unknown>;
  } catch {
    throw notGame('data/System.json 을 읽을 수 없습니다');
  }

  const key = typeof system.encryptionKey === 'string' && system.encryptionKey !== '' ? system.encryptionKey : null;
  return {
    engine,
    topDir,
    contentDir,
    contentPrefix,
    encryptedImages: system.hasEncryptedImages === true,
    encryptionKey: key,
  };
}
