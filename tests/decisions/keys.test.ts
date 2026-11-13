import { afterAll, beforeAll, expect, test } from 'vitest';
import { groupDecisions } from '../../src/core/decisions/keys.js';
import { decisionFor, isTranslatable, loadDecisions, saveDecisions } from '../../src/core/decisions/store.js';
import type { Decision, Decisions } from '../../src/core/decisions/types.js';
import type { TextUnit } from '../../src/core/types.js';
import { setupProject, type Fixture } from '../helpers/project.js';
import { cleanupTempDirs } from '../helpers/fs.js';

let fx: Fixture;
beforeAll(async () => { fx = await setupProject(); });
afterAll(cleanupTempDirs);

const yes: Decision = { translate: true, keep: { mode: 'whole' }, status: 'confirmed', by: 'user' };
const no: Decision = { translate: false, keep: { mode: 'whole' }, status: 'confirmed', by: 'user' };

test('추출이 decisionKey 를 채운다', () => {
  expect(fx.units.find((u) => u.source === 'ShowRecord 記録')!.decisionKey).toBe('mv:ShowRecord');
  expect(fx.units.find((u) => u.source === '物語')!.decisionKey).toBe('param:Menu:list[*].label');
  expect(fx.units.find((u) => u.source === '記録')!.decisionKey).toBe('param:Menu:title');
  expect(fx.units.find((u) => u.source === 'リナ')!.decisionKey).toBeUndefined();
});

function unit(id: string, source: string, key: string, refs = 1): TextUnit {
  return { id, kind: 'plugin-command', source, needsDecision: true, decisionKey: key,
    refs: Array.from({ length: refs }, (_, i) => ({ type: 'value' as const, file: 'data/Map001.json', path: [i] })) };
}

test('groupDecisions: 같은 키끼리, 표본 5개까지, 파일 이름 힌트, 많은 순', () => {
  const units = [
    unit('a', 'ShowPic 立ち絵', 'mv:ShowPic'),
    ...['一', '二', '三', '四', '五', '六'].map((s, i) => unit(`p${i}`, `絵${s}`, 'mz:Pic:show:name', 2)),
    unit('x', '立ち絵', 'mz:Pic:show:name'),
  ];
  const d: Decisions = { 'mz:Pic:show:name': no };
  const groups = groupDecisions(units, d, { fileNames: new Set(['絵一', '絵二', '立ち絵']), meta: {} });
  expect(groups.map((g) => g.key)).toEqual(['mz:Pic:show:name', 'mv:ShowPic']);
  const g = groups[0];
  expect(g.count).toBe(13);
  expect(g.samples).toHaveLength(5);
  expect(g.hints.fileNames).toBe(2);
  expect(g.decision).toEqual(no);
  expect(g.label).toBe('Pic · show · name');
  expect(groups[1]).toMatchObject({ label: 'ShowPic', count: 1, samples: ['ShowPic 立ち絵'], decision: null, kind: 'plugin-command' });
});

test('isTranslatable 과 decisionFor', () => {
  const u = unit('a', 'ShowRecord 記録', 'mv:ShowRecord');
  expect(isTranslatable(u, {})).toBe(false);
  expect(isTranslatable(u, { 'mv:ShowRecord': yes })).toBe(true);
  expect(isTranslatable(u, { 'mv:ShowRecord': yes, 'unit:a': no })).toBe(false);
  expect(decisionFor(u, { 'mv:ShowRecord': yes, 'unit:a': no })).toEqual(no);
  expect(decisionFor(u, {})).toBeNull();
  // Nothing left to translate -> not translatable.
  expect(isTranslatable(u, { 'mv:ShowRecord': { ...yes, keep: { mode: 'args', from: 2, dropLast: 0 } } })).toBe(false);
  // A suggestion is not acted on yet.
  expect(isTranslatable(u, { 'mv:ShowRecord': { ...yes, status: 'suggested', by: 'claude' } })).toBe(false);
  const plain: TextUnit = { id: 'd', kind: 'dialogue', source: 'あ', needsDecision: false, refs: [] };
  expect(isTranslatable(plain, {})).toBe(true);
});

test('decisions.json 저장과 읽기', async () => {
  expect(await loadDecisions(fx.proj)).toEqual({});
  await saveDecisions(fx.proj, { 'mv:ShowRecord': yes });
  expect(await loadDecisions(fx.proj)).toEqual({ 'mv:ShowRecord': yes });
});
