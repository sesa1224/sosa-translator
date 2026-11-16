import { rm } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, expect, test } from 'vitest';
import { autoDecide } from '../../src/core/decisions/auto.js';
import { ProjectService } from '../../src/main/projectService.js';
import { buildDecidePrompt, DecideJob, pluginCodeSnippet, settingOf, SNIPPET_MAX_CHARS, SNIPPET_MAX_LINE } from '../../src/main/translate/decide.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';
import { makeMiniGame } from '../helpers/miniGame.js';
import { someUsage, type FakeCall } from './jobHelpers.js';

let svc: ProjectService | null = null;
afterEach(async () => { await svc?.close(); svc = null; });
afterAll(cleanupTempDirs);

const KEYS = 'param-keys:Speed:Speed List';

async function open(o: { withoutSpeedJs?: boolean } = {}): Promise<ProjectService> {
  const game = await makeTempDir();
  await makeMiniGame(game, { keys: true });
  if (o.withoutSpeedJs) await rm(path.join(game, 'js', 'plugins', 'Speed.js'));
  svc = await ProjectService.create(game, path.join(await makeTempDir(), 'proj'), '약초원');
  await svc.addExtraString('Monitor FPS Sync');
  return svc;
}

/** Runs a decide job that answers 'do not translate' to everything and returns what was sent. */
async function sent(s: ProjectService): Promise<{ system: string; groups: any[] }[]> {
  const seen: { system: string; groups: any[] }[] = [];
  const call: FakeCall = async (o: any) => {
    const user = JSON.parse(o.user);
    seen.push({ system: o.system, groups: user.groups });
    return { ok: true, data: { decisions: user.groups.map((g: any) => ({ key: g.key, translate: false, mode: 'whole', reason: 'x' })) }, usage: { ...someUsage } };
  };
  await new DecideJob({ svc: s, call: call as any, claude: { command: 'claude' }, model: 'm', cwd: '.' }).start();
  return seen;
}

test('설정 이름이 나오는 줄과 그 값을 담은 변수가 쓰이는 줄을 자른다, 머리말 주석은 빼고', () => {
  const js = '/*:\n * @param Speed List\n * @default "Speed List"\n */\n(function() {\n  var p = PluginManager.parameters(\'Speed\');\n  var speedList = JSON.parse(p[\'Speed List\']);\n  var other = 1;\n  function f(i) { return Object.keys(speedList)[i]; }\n  var speedListX = 2;\n})();\n';
  expect(pluginCodeSnippet(js, 'Speed List')).toBe("7: var speedList = JSON.parse(p['Speed List']);\n9: function f(i) { return Object.keys(speedList)[i]; }");
  expect(pluginCodeSnippet(js, 'Nope')).toBe('');
  // An identifier-like name also matches as a property.
  expect(pluginCodeSnippet('var a = params.Title;\nshow(a);\n', 'Title')).toBe('1: var a = params.Title;\n2: show(a);');
  // CRLF files are numbered the same.
  expect(pluginCodeSnippet(js.replace(/\n/g, '\r\n'), 'Speed List')).toBe("7: var speedList = JSON.parse(p['Speed List']);\n9: function f(i) { return Object.keys(speedList)[i]; }");
});

test('조각은 줄마다 160자, 모두 800자를 넘지 않는다', () => {
  const long = 'x'.repeat(400);
  const js = `var list = P['L'];\n` + Array.from({ length: 30 }, (_, i) => `use(list, ${i}, '${long}');`).join('\n');
  const code = pluginCodeSnippet(js, 'L');
  expect(code.length).toBeLessThanOrEqual(SNIPPET_MAX_CHARS);
  for (const line of code.split('\n')) expect(line.replace(/^\d+: /, '').length).toBeLessThanOrEqual(SNIPPET_MAX_LINE);
  expect(code.startsWith("1: var list = P['L'];")).toBe(true);
});

test('설정 키에서 플러그인과 설정 이름을 읽는다', () => {
  expect(settingOf(KEYS)).toEqual({ plugin: 'Speed', setting: 'Speed List' });
  expect(settingOf('param:Menu:list[*].label')).toEqual({ plugin: 'Menu', setting: 'list' });
  expect(settingOf('mv:ShowRecord')).toBeNull();
});

test('열쇠 묶음과 등록한 영어 항목의 묶음에 코드 조각이 붙고, 그 호출에만 설명이 더해진다', async () => {
  const s = await open();
  const seen = await sent(s);
  const groups = seen.flatMap((x) => x.groups);
  const keys = groups.find((g) => g.key === KEYS);
  expect(keys.label).toBe('Speed · Speed List · 열쇠 이름');
  expect(keys.code).toBe("8: var speedList = JSON.parse(parameters['Speed List']);\n10: return Object.keys(speedList)[i];");
  const fps = groups.find((g) => g.key === 'param:Fps:Command Name');
  expect(fps.code).toBe("5: var fpsName = String(PluginManager.parameters('Fps')['Command Name'] || 'Monitor FPS Sync');");
  // Japanese values say enough by themselves.
  expect(groups.find((g) => g.key === 'param:Speed:Speed Term').code).toBeUndefined();
  const system = seen.find((x) => x.groups.some((g) => g.key === KEYS))!.system;
  expect(system).toContain('param-keys: 로 시작하는 묶음은 값이 아니라 객체의 열쇠 이름이다');
  expect(buildDecidePrompt([{ key: 'mv:A', label: 'A', kind: 'plugin-command', count: 1, samples: ['あ'] }]).system).not.toContain('param-keys:');
});

test('플러그인 파일이 없으면 조각 없이 보낸다', async () => {
  const s = await open({ withoutSpeedJs: true });
  const keys = (await sent(s)).flatMap((x) => x.groups).find((g) => g.key === KEYS);
  expect(keys).toBeDefined();
  expect(keys.code).toBeUndefined();
});

test('자동 추천은 열쇠 묶음을 건드리지 않는다', async () => {
  const s = await open();
  const g = s.decisionGroups().find((x) => x.key === KEYS)!;
  // Even with every sample looking like a file name, a key-name group is left to the code check.
  expect(autoDecide([{ ...g, hints: { fileNames: g.samples.length, metaType: 'file' } }])).toEqual({});
});
