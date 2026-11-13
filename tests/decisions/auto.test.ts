import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { loadPluginMeta, parsePluginMeta } from '../../src/core/extract/pluginMeta.js';
import { autoDecide, mergeSuggestions } from '../../src/core/decisions/auto.js';
import type { Decision, DecisionGroup } from '../../src/core/decisions/types.js';
import { setupProject } from '../helpers/project.js';
import { cleanupTempDirs } from '../helpers/fs.js';

afterAll(cleanupTempDirs);

const HEADER = `/*:
 * @target MZ
 * @plugindesc Destination window
 *
 * @param bgImage
 * @text Background
 * @type file
 * @dir img/pictures
 *
 * @param items
 * @type struct<Item>[]
 *
 * @command SET_DESTINATION
 * @text Set destination
 * @desc Sets the text.
 *
 * @arg destination
 * @type multiline_string
 * @text Destination
 */
/*~struct~Item:
 * @param label
 * @type string
 * @text Label
 */
var x = 1;
`;

const HEADER_JA = HEADER + `/*:ja
 * @command SET_DESTINATION
 * @text 目標設定
 *
 * @arg destination
 * @type multiline_string
 * @text 行動目標
 * @desc ウィンドウに表示する文字
 */
`;

test('parsePluginMeta: @param, @command, @arg 와 /*:ja 우선', () => {
  const m = parsePluginMeta(HEADER);
  expect(m.params.bgImage).toEqual({ type: 'file', text: 'Background' });
  expect(m.commands.SET_DESTINATION.text).toBe('Set destination');
  expect(m.commands.SET_DESTINATION.args.destination).toEqual({ type: 'multiline_string', text: 'Destination' });
  expect(m.structs?.Item.label).toEqual({ type: 'string', text: 'Label' });
  const ja = parsePluginMeta(HEADER_JA);
  expect(ja.commands.SET_DESTINATION.args.destination).toEqual({ type: 'multiline_string', text: '行動目標', desc: 'ウィンドウに表示する文字' });
  expect(ja.commands.SET_DESTINATION.text).toBe('目標設定');
  expect(parsePluginMeta('var a = 1;')).toEqual({ params: {}, commands: {}, structs: {} });
});

test('loadPluginMeta: 플러그인 이름별', async () => {
  const fx = await setupProject();
  await mkdir(path.join(fx.proj, 'original/v1/js/plugins'), { recursive: true });
  await writeFile(path.join(fx.proj, 'original/v1/js/plugins/Menu.js'), HEADER_JA);
  const all = await loadPluginMeta(fx.proj);
  expect(Object.keys(all)).toEqual(['Menu']);
  expect(all.Menu.commands.SET_DESTINATION.args.destination.text).toBe('行動目標');
});

function group(key: string, hints: DecisionGroup['hints'], samples = ['あ'], decision: Decision | null = null): DecisionGroup {
  return { key, label: key, kind: 'plugin-param', count: samples.length, samples, hints, decision };
}

test('자동 규칙 표의 각 줄', () => {
  const d = autoDecide([
    group('param:A:bg', { fileNames: 0, metaType: 'file' }),
    group('param:A:bgs', { fileNames: 0, metaType: 'file[]' }),
    group('param:A:sw', { fileNames: 0, metaType: 'switch' }),
    group('mz:A:c:pic', { fileNames: 4 }, ['a', 'b', 'c', 'd', 'e']),
    group('mz:A:c:dest', { fileNames: 0, metaType: 'multiline_string', metaText: '行動目標', metaDesc: 'ウィンドウに表示する文字' }),
    group('param:A:label', { fileNames: 0, metaType: 'string', metaText: 'Menu Label' }),
    group('param:A:code', { fileNames: 0, metaType: 'string', metaText: '判定キー' }),
    group('mz:A:c:few', { fileNames: 3 }, ['a', 'b', 'c', 'd', 'e']),
    group('mv:X', { fileNames: 0 }),
  ]);
  expect(d['param:A:bg']).toEqual({ translate: false, keep: { mode: 'whole' }, status: 'suggested', by: 'meta', reason: '플러그인이 이 값을 file 로 선언함' });
  expect(d['param:A:bgs']).toMatchObject({ translate: false, reason: '플러그인이 이 값을 file[] 로 선언함' });
  expect(d['param:A:sw']).toMatchObject({ translate: false, reason: '플러그인이 이 값을 switch 로 선언함' });
  expect(d['mz:A:c:pic']).toEqual({ translate: false, keep: { mode: 'whole' }, status: 'suggested', by: 'meta', reason: '그림·소리 파일 이름과 같음' });
  expect(d['mz:A:c:dest']).toEqual({ translate: true, keep: { mode: 'whole' }, status: 'suggested', by: 'meta', reason: '플러그인 설명에 표시용 글자라고 적힘' });
  expect(d['param:A:label']).toMatchObject({ translate: true });
  expect(d).not.toHaveProperty('param:A:code');
  expect(d).not.toHaveProperty('mz:A:c:few');
  expect(d).not.toHaveProperty('mv:X');
});

test('확정된 결정은 건드리지 않는다', () => {
  const confirmed: Decision = { translate: true, keep: { mode: 'whole' }, status: 'confirmed', by: 'user' };
  const d = autoDecide([group('param:A:bg', { fileNames: 0, metaType: 'file' }, ['あ'], confirmed)]);
  expect(d).toEqual({});
  const old: Decision = { translate: true, keep: { mode: 'whole' }, status: 'suggested', by: 'claude' };
  const fresh: Decision = { translate: false, keep: { mode: 'whole' }, status: 'suggested', by: 'meta', reason: 'r' };
  const merged = mergeSuggestions({ a: confirmed, b: old, c: old }, { a: fresh, b: fresh });
  expect(merged).toEqual({ a: confirmed, b: fresh, c: old });
});

test('groupDecisions 가 주석의 type/text/desc 를 힌트로 싣는다 (struct 안쪽 포함)', async () => {
  const { groupDecisions } = await import('../../src/core/decisions/keys.js');
  const meta = { Menu: parsePluginMeta(HEADER_JA.replace('@param items', '@param list')) };
  const units = [
    { id: 'a', kind: 'plugin-param' as const, source: '物語', needsDecision: true, decisionKey: 'param:Menu:list[*].label', refs: [] },
    { id: 'b', kind: 'plugin-command' as const, source: '北へ', needsDecision: true, decisionKey: 'mz:Menu:SET_DESTINATION:destination', refs: [] },
  ];
  const groups = groupDecisions(units, {}, { fileNames: new Set(), meta });
  expect(groups.find((g) => g.key.startsWith('param'))!.hints).toEqual({ fileNames: 0, metaType: 'string', metaText: 'Label' });
  expect(groups.find((g) => g.key.startsWith('mz'))!.hints).toMatchObject({ metaType: 'multiline_string', metaText: '行動目標' });
});
