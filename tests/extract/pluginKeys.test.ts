import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { applyTranslationsDetailed } from '../../src/core/build/apply.js';
import { saveDecisions } from '../../src/core/decisions/store.js';
import type { Decision } from '../../src/core/decisions/types.js';
import { extractAll, extractFromDir } from '../../src/core/extract/index.js';
import { extractFromPlugins, parsePluginsFile } from '../../src/core/extract/plugins.js';
import { EXTRACT_FILE, EXTRACTOR_VERSION, loadExtractSettings, saveExtractSettings } from '../../src/core/extract/settings.js';
import { createProject } from '../../src/core/project/project.js';
import { TranslationStore } from '../../src/core/store/translations.js';
import type { TextUnit } from '../../src/core/types.js';
import { locationLabel } from '../../src/shared/rows.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';
import { KEY_PLUGINS_JS_TEXT, makeMiniGame } from '../helpers/miniGame.js';

afterAll(cleanupTempDirs);

const plugins = () => parsePluginsFile(KEY_PLUGINS_JS_TEXT).plugins;
const KEYS = 'param-keys:Speed:Speed List';
const yes: Decision = { translate: true, keep: { mode: 'whole' }, status: 'confirmed', by: 'user' };
const no: Decision = { translate: false, keep: { mode: 'whole' }, status: 'confirmed', by: 'user' };

test('중첩 JSON 의 일본어 열쇠 이름을 낸다, 설정 이름과 플러그인 이름은 내지 않는다', () => {
  const raw = extractFromPlugins(plugins());
  const keys = raw.filter((r) => r.ref.type === 'key');
  expect(keys.map((r) => r.source)).toEqual(['遅い', '標準', '速い']);
  expect(keys[0]).toMatchObject({ kind: 'plugin-param', needsDecision: true, decisionKey: KEYS, distinct: KEYS });
  expect(keys[0].ref).toEqual({ type: 'key', file: 'js/plugins.js', path: [1, 'parameters', { key: 'Speed List', json: true }], key: '遅い' });
  expect(raw.map((r) => r.source)).not.toContain('Speed List');
  expect(raw.map((r) => r.source)).not.toContain('Speed');
  // The English option name is left out unless asked for.
  expect(raw.map((r) => r.source)).not.toContain('Monitor FPS Sync');
});

test('영어 문자열은 목록에 있을 때만, 값과 열쇠 이름에서 글자 전체가 같을 때만 낸다', () => {
  const raw = extractFromPlugins(plugins(), { extraStrings: ['Monitor FPS Sync', 'FPS'] });
  const fps = raw.filter((r) => r.source === 'Monitor FPS Sync');
  expect(fps).toHaveLength(1);
  expect(fps[0]).toMatchObject({ needsDecision: true, decisionKey: 'param:Fps:Command Name', ref: { type: 'value', path: [2, 'parameters', 'Command Name'] } });
  expect(raw.map((r) => r.source)).not.toContain('FPS');
  // A key name in the list counts too.
  const k = extractFromPlugins([{ name: 'P', parameters: { list: '{"Fast": 1, "Slow": 2}' } }], { extraStrings: ['Fast'] });
  expect(k.map((r) => [r.source, r.ref.type])).toEqual([['Fast', 'key']]);
});

async function project(): Promise<{ proj: string; units: TextUnit[]; store: TranslationStore }> {
  const game = await makeTempDir();
  await makeMiniGame(game, { keys: true });
  const proj = path.join(await makeTempDir(), 'proj');
  await createProject(game, proj, '약초원');
  const { units } = await extractAll(proj);
  return { proj, units, store: await TranslationStore.load(proj) };
}

const keyUnit = (units: TextUnit[], source: string) => units.find((u) => u.source === source && u.refs[0].type === 'key')!;
const valueUnit = (units: TextUnit[], source: string) => units.find((u) => u.source === source && u.refs[0].type === 'value')!;
const speedList = (pluginsJs: string): Record<string, number> => {
  const p = parsePluginsFile(pluginsJs).plugins as { name: string; parameters: Record<string, string> }[];
  return JSON.parse(p.find((x) => x.name === 'Speed')!.parameters['Speed List']);
};

test('같은 글자의 값 항목과 열쇠 항목은 id 가 다르고, 화면 위치 이름도 다르다', async () => {
  const { units } = await project();
  const key = keyUnit(units, '標準');
  const value = valueUnit(units, '標準');
  expect(key.id).not.toBe(value.id);
  expect(key.refs).toHaveLength(1);
  expect(locationLabel(key)).toBe('플러그인 설정 · 열쇠 이름');
  expect(locationLabel(value)).toBe('플러그인 설정');
});

test('extractAll 은 extract.json 의 목록을 쓰고 추출기 버전을 남긴다', async () => {
  const { proj, units } = await project();
  expect(units.some((u) => u.source === 'Monitor FPS Sync')).toBe(false);
  expect(await loadExtractSettings(proj)).toEqual({ extraStrings: [], extractorVersion: EXTRACTOR_VERSION });
  await saveExtractSettings(proj, { extraStrings: ['Monitor FPS Sync'] });
  const again = (await extractAll(proj)).units;
  expect(again.find((u) => u.source === 'Monitor FPS Sync')).toMatchObject({ kind: 'plugin-param', needsDecision: true });
  // Every unit of before keeps its id.
  const ids = new Set(again.map((u) => u.id));
  expect(units.every((u) => ids.has(u.id))).toBe(true);
  expect(JSON.parse(await readFile(path.join(proj, EXTRACT_FILE), 'utf8'))).toEqual({ extraStrings: ['Monitor FPS Sync'], extractorVersion: EXTRACTOR_VERSION });
});

test('extractFromDir 는 아무것도 쓰지 않고 목록을 받는다', async () => {
  const game = await makeTempDir();
  await makeMiniGame(game, { keys: true });
  const { units } = await extractFromDir(game, { extraStrings: ['Monitor FPS Sync'] });
  expect(units.filter((u) => u.source === 'Monitor FPS Sync')).toHaveLength(1);
});

test('열쇠 이름을 바꾸고 순서, 값, 나머지 설정은 그대로 둔다', async () => {
  const { proj, units, store } = await project();
  await saveDecisions(proj, { [KEYS]: yes });
  store.set(keyUnit(units, '遅い').id, '느림');
  store.set(keyUnit(units, '標準').id, '보통');
  store.set(keyUnit(units, '速い').id, '빠름');
  const { files, warnings } = await applyTranslationsDetailed(proj, units, store, { decisions: { [KEYS]: yes } });
  expect(warnings).toEqual([]);
  const out = files.get('js/plugins.js')!;
  const list = speedList(out);
  expect(Object.keys(list)).toEqual(['느림', '보통', '빠름']);
  expect(Object.values(list)).toEqual([-1, 0, 1]);
  // Read back as RPG Maker reads it, and nothing else moved.
  const before = parsePluginsFile(KEY_PLUGINS_JS_TEXT).plugins as { name: string; parameters: Record<string, string> }[];
  const after = parsePluginsFile(out).plugins as typeof before;
  expect(after.map((p) => p.name)).toEqual(before.map((p) => p.name));
  expect(after[0]).toEqual(before[0]);
  expect(after[2]).toEqual(before[2]);
  expect({ ...after[1].parameters, 'Speed List': '' }).toEqual({ ...before[1].parameters, 'Speed List': '' });
});

test('판단이 번역 안 함이면 열쇠 이름은 바뀌지 않는다, 같은 글자의 값을 번역해도 열쇠는 그대로다', async () => {
  const { proj, units, store } = await project();
  store.set(keyUnit(units, '標準').id, '보통');
  store.set(valueUnit(units, '標準').id, '기본');
  const decisions = { [KEYS]: no, 'param:Speed:Default Label': yes };
  const { files } = await applyTranslationsDetailed(proj, units, store, { decisions });
  const out = files.get('js/plugins.js')!;
  expect(Object.keys(speedList(out))).toEqual(['遅い', '標準', '速い']);
  const speed = (parsePluginsFile(out).plugins as { name: string; parameters: Record<string, string> }[]).find((p) => p.name === 'Speed')!;
  expect(speed.parameters['Default Label']).toBe('기본');
});

test('겹치는 이름은 건너뛰고 경고한다, 다른 열쇠가 떠나는 이름은 쓸 수 있다', async () => {
  const { proj, units, store } = await project();
  store.set(keyUnit(units, '遅い').id, '速い');
  store.set(keyUnit(units, '速い').id, '빠름');
  let r = await applyTranslationsDetailed(proj, units, store, { decisions: { [KEYS]: yes } });
  expect(r.warnings).toEqual([]);
  expect(speedList(r.files.get('js/plugins.js')!)).toEqual({ 速い: -1, 標準: 0, 빠름: 1 });

  // 遅い and 標準 clash with each other; once they stay, 速い → 遅い clashes with the 遅い that stayed.
  store.set(keyUnit(units, '遅い').id, '보통');
  store.set(keyUnit(units, '標準').id, '보통');
  store.set(keyUnit(units, '速い').id, '遅い');
  r = await applyTranslationsDetailed(proj, units, store, { decisions: { [KEYS]: yes } });
  const list = speedList(r.files.get('js/plugins.js')!);
  expect(list).toEqual({ 遅い: -1, 標準: 0, 速い: 1 });
  const warnings = r.warnings;
  expect(warnings.map((w) => w.message)).toEqual([
    '열쇠 이름 "遅い" 의 번역 "보통" 이 같은 객체의 다른 열쇠와 겹쳐 바꾸지 않았습니다',
    '열쇠 이름 "標準" 의 번역 "보통" 이 같은 객체의 다른 열쇠와 겹쳐 바꾸지 않았습니다',
    '열쇠 이름 "速い" 의 번역 "遅い" 이 같은 객체의 다른 열쇠와 겹쳐 바꾸지 않았습니다',
  ]);
});

test('옛 project 의 units.json 에 없던 파일: extract.json 이 없으면 0 버전으로 본다', async () => {
  const dir = await makeTempDir();
  expect(await loadExtractSettings(dir)).toEqual({ extraStrings: [] });
  await writeFile(path.join(dir, EXTRACT_FILE), '{"extraStrings":["A",3,""],"extractorVersion":1}');
  expect(await loadExtractSettings(dir)).toEqual({ extraStrings: ['A'], extractorVersion: 1 });
});
