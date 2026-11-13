import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Engine } from '../../src/core/types.js';

/** Exact text of the mini game's js/plugins.js (see plan, Task 1). */
export const PLUGINS_JS_TEXT =
  'var $plugins =\n' +
  '[{"name":"Menu","status":true,"description":"","parameters":{"title":"記録","list":"[\\"{\\\\\\"label\\\\\\":\\\\\\"物語\\\\\\",\\\\\\"id\\\\\\":\\\\\\"story\\\\\\"}\\"]","speed":"4"}}];\n';

export const ENCRYPTION_KEY = 'd41d8cd98f00b204e9800998ecf8427e';

export function miniSystem(encrypted = false) {
  return {
    gameTitle: '霧の薬草園', currencyUnit: 'ゴールド',
    hasEncryptedImages: encrypted, encryptionKey: encrypted ? ENCRYPTION_KEY : '',
    terms: { basic: ['レベル', 'Lv'], commands: ['たたかう', null], params: ['最大HP'], messages: { alwaysDash: '常時ダッシュ' } },
    elements: ['', '物理'], skillTypes: ['', '魔法'], weaponTypes: [''], armorTypes: [''], equipTypes: ['', '武器'],
  };
}

export function miniActors() {
  return [null, { id: 1, name: 'リナ', nickname: '', profile: '薬草園の見習い', note: '' }];
}

export function miniItems() {
  return [null, { id: 1, name: '月光草', description: '夜に光る草。\\C[2]貴重\\C[0]だ', note: '' }];
}

export function miniCommonEvents() {
  return [null, { id: 1, name: '', list: [
    { code: 105, indent: 0, parameters: [2, false] },
    { code: 405, indent: 0, parameters: ['むかしむかし'] },
    { code: 0, indent: 0, parameters: [] } ] }];
}

export function miniMap(engine: Engine = 'MZ') {
  const head = (): unknown[] => (engine === 'MZ' ? ['', 0, 0, 2, 'リナ'] : ['', 0, 0, 2]);
  return { displayName: '薬草園', events: [null, { id: 1, name: 'EV001', pages: [{ list: [
    { code: 101, indent: 0, parameters: head() },
    { code: 401, indent: 0, parameters: ['あれ？\\N[1]じゃない！'] },
    { code: 401, indent: 0, parameters: ['こんな夜に来るなんて'] },
    { code: 102, indent: 0, parameters: [['いいよ', 'また今度'], 1, 0, 2, 0] },
    { code: 402, indent: 0, parameters: [0, 'いいよ'] },
    { code: 101, indent: 1, parameters: head() },
    { code: 401, indent: 1, parameters: ['やった！'] },
    { code: 0, indent: 1, parameters: [] },
    { code: 402, indent: 0, parameters: [1, 'また今度'] },
    { code: 0, indent: 1, parameters: [] },
    { code: 404, indent: 0, parameters: [] },
    { code: 356, indent: 0, parameters: ['ShowRecord 記録'] },
    { code: 0, indent: 0, parameters: [] } ] }] }] };
}

/** Writes a tiny MV/MZ game into dir (test only). */
export async function makeMiniGame(
  dir: string,
  opts: { engine?: Engine; www?: boolean; encrypted?: boolean } = {},
): Promise<void> {
  const engine = opts.engine ?? 'MZ';
  const root = opts.www ? path.join(dir, 'www') : dir;
  const data = path.join(root, 'data');
  const js = path.join(root, 'js');
  await mkdir(data, { recursive: true });
  await mkdir(js, { recursive: true });

  const files: Record<string, unknown> = {
    'System.json': miniSystem(opts.encrypted ?? false),
    'Actors.json': miniActors(),
    'Items.json': miniItems(),
    'MapInfos.json': [null, { id: 1, name: 'MAP001' }],
    'CommonEvents.json': miniCommonEvents(),
    'Map001.json': miniMap(engine),
  };
  for (const name of ['Classes', 'Skills', 'Weapons', 'Armors', 'Enemies', 'States', 'Troops']) {
    files[`${name}.json`] = [null];
  }
  for (const [name, json] of Object.entries(files)) {
    await writeFile(path.join(data, name), JSON.stringify(json), 'utf8');
  }
  await writeFile(path.join(js, 'plugins.js'), PLUGINS_JS_TEXT, 'utf8');
  await writeFile(path.join(js, engine === 'MZ' ? 'rmmz_core.js' : 'rpg_core.js'), '', 'utf8');
}
