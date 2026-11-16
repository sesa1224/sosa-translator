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

export const INDEX_HTML_TEXT = '<!DOCTYPE html>\n<html>\n<head>\n<meta charset="UTF-8">\n<title>霧の薬草園</title>\n</head>\n<body></body>\n</html>\n';

/** Header-commented plugin file of the decisions extras: one display string, one file argument. */
export const MENU_PLUGIN_JS =
  '/*:\n * @target MZ\n * @plugindesc メニュー\n *\n * @command SET_DESTINATION\n * @text 目標設定\n *\n * @arg destination\n * @type multiline_string\n * @text 行動目標\n *\n' +
  ' * @command SHOW_PIC\n *\n * @arg picture\n * @type file\n * @dir img/pictures\n */\n' +
  '(() => {\n  const label = "記録を見る";\n  const key = "story";\n  PluginManager.registerCommand("Menu", "SET_DESTINATION", (a) => { $gameSystem._dest = a.destination; });\n})();\n';

/** Map001 commands of the decisions extras: two MZ plugin commands (display text, picture file). */
export function decisionCommands(): unknown[] {
  return [
    { code: 357, indent: 0, parameters: ['Menu', 'SET_DESTINATION', '目標設定', { destination: '北の森へ行く' }] },
    { code: 357, indent: 0, parameters: ['Menu', 'SHOW_PIC', '絵', { picture: '立ち絵' }] },
  ];
}

/**
 * Plugins of the key-name extras: Speed shows the Japanese key names of a JSON object in its option (and has a value
 * equal to one of them), Fps has an English option name.
 */
export const KEY_PLUGINS = [
  { name: 'Speed', status: true, description: '', parameters: {
    'Speed Term': '速度',
    'Speed List': '{"遅い": -1, "標準": 0, "速い": 1}',
    'Default Label': '標準',
  } },
  { name: 'Fps', status: true, description: '', parameters: { 'Command Name': 'Monitor FPS Sync', 'Default Value': 'true' } },
];

/** js/plugins.js of the key-name extras: the mini game's Menu plugin and KEY_PLUGINS, one per line as RPG Maker writes it. */
export const KEY_PLUGINS_JS_TEXT = (() => {
  const menu = PLUGINS_JS_TEXT.slice(PLUGINS_JS_TEXT.indexOf('[') + 1, PLUGINS_JS_TEXT.lastIndexOf(']'));
  return 'var $plugins =\n[\n' + [menu, ...KEY_PLUGINS.map((p) => JSON.stringify(p))].join(',\n') + '\n];\n';
})();

/** Speed.js: reads 'Speed List' into a variable and shows its key names in the options. */
export const SPEED_PLUGIN_JS =
  '/*:\n * @plugindesc 速度\n * @param Speed List\n * @default {"遅い": -1, "標準": 0}\n */\n' +
  '(function() {\n' +
  "  var parameters = PluginManager.parameters('Speed');\n" +
  "  var speedList = JSON.parse(parameters['Speed List']);\n" +
  '  Window_Options.prototype.speedText = function(i) {\n' +
  '    return Object.keys(speedList)[i];\n' +
  '  };\n' +
  '})();\n';

/** Fps.js: the English option name, also once as a string literal in code. */
export const FPS_PLUGIN_JS =
  "/*:\n * @param Command Name\n * @default Monitor FPS Sync\n */\nvar fpsName = String(PluginManager.parameters('Fps')['Command Name'] || 'Monitor FPS Sync');\n";

/**
 * Writes a tiny MV/MZ game into dir (test only). decisions: adds the decisions extras (note tag, MZ commands, plugin JS file).
 * keys: adds the key-name extras (KEY_PLUGINS and their files).
 */
export async function makeMiniGame(
  dir: string,
  opts: { engine?: Engine; www?: boolean; encrypted?: boolean; decisions?: boolean; keys?: boolean; variant?: 'v2' } = {},
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

  // Files every game has; they add no text units.
  await writeFile(path.join(root, 'index.html'), INDEX_HTML_TEXT, 'utf8');
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'kiri-no-yakusouen', main: 'index.html', window: { title: '霧の薬草園', width: 816, height: 624 } }, null, 2), 'utf8');
  await mkdir(path.join(root, 'img', 'pictures'), { recursive: true });
  for (const f of ['立ち絵.png', '背景.png', 'title.png']) await writeFile(path.join(root, 'img', 'pictures', f), '');

  if (opts.decisions) {
    const items = miniItems();
    (items[1] as { note: string }).note = '<SG説明:夜に光る草>\n<price:100>';
    await writeFile(path.join(data, 'Items.json'), JSON.stringify(items), 'utf8');
    const map = miniMap(engine);
    const list = map.events[1]!.pages[0].list as unknown[];
    list.splice(list.length - 1, 0, ...decisionCommands());
    await writeFile(path.join(data, 'Map001.json'), JSON.stringify(map), 'utf8');
    await mkdir(path.join(js, 'plugins'), { recursive: true });
    await writeFile(path.join(js, 'plugins', 'Menu.js'), MENU_PLUGIN_JS, 'utf8');
  }

  if (opts.keys) {
    await writeFile(path.join(js, 'plugins.js'), KEY_PLUGINS_JS_TEXT, 'utf8');
    await mkdir(path.join(js, 'plugins'), { recursive: true });
    await writeFile(path.join(js, 'plugins', 'Speed.js'), SPEED_PLUGIN_JS, 'utf8');
    await writeFile(path.join(js, 'plugins', 'Fps.js'), FPS_PLUGIN_JS, 'utf8');
  }

  if (opts.variant === 'v2') await writeV2(data, engine);
}

/**
 * The next version of the mini game: one line of the first message rewritten, 'やった！' → 'やった！！', a wait
 * command added at the front of the map event, a new item, the common event's scroll text removed and a new title.
 */
async function writeV2(data: string, engine: Engine): Promise<void> {
  const map = miniMap(engine);
  const list = map.events[1]!.pages[0].list as { code: number; indent: number; parameters: unknown[] }[];
  list[2].parameters[0] = 'こんな夜更けに来るなんて';
  list[6].parameters[0] = 'やった！！';
  list.unshift({ code: 230, indent: 0, parameters: [30] });
  await writeFile(path.join(data, 'Map001.json'), JSON.stringify(map), 'utf8');
  const items = miniItems() as unknown[];
  items.push({ id: 2, name: '星の砂', description: '光る砂', note: '' });
  await writeFile(path.join(data, 'Items.json'), JSON.stringify(items), 'utf8');
  const common = miniCommonEvents();
  common[1]!.list = common[1]!.list.filter((c) => c.code !== 105 && c.code !== 405);
  await writeFile(path.join(data, 'CommonEvents.json'), JSON.stringify(common), 'utf8');
  await writeFile(path.join(data, 'System.json'), JSON.stringify({ ...miniSystem(false), gameTitle: '霧の薬草園 ver1.1' }), 'utf8');
}
