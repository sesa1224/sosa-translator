import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { createProject } from '../../src/core/project/project.js';
import {
  availableWidth, DEFAULT_METRICS, detectMetrics, effectiveMetrics, loadPreviewSettings, savePreviewSettings,
} from '../../src/core/preview/metrics.js';
import type { Engine } from '../../src/core/types.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';
import { makeMiniGame } from '../helpers/miniGame.js';

afterAll(cleanupTempDirs);

async function project(engine: Engine, edit: { system?: (s: any) => void; plugins?: unknown[] } = {}): Promise<string> {
  const game = await makeTempDir();
  await makeMiniGame(game, { engine });
  if (edit.system) {
    const f = path.join(game, 'data', 'System.json');
    const s = JSON.parse(await readFile(f, 'utf8'));
    edit.system(s);
    await writeFile(f, JSON.stringify(s), 'utf8');
  }
  if (edit.plugins) await writeFile(path.join(game, 'js', 'plugins.js'), `var $plugins =\n${JSON.stringify(edit.plugins)};\n`, 'utf8');
  const proj = path.join(await makeTempDir(), 'proj');
  await createProject(game, proj, 'p');
  return proj;
}

const yep = (status: boolean, params: Record<string, string>) => ({ name: 'YEP_CoreEngine', status, description: '', parameters: params });

test('MZ: System.json advanced 값', async () => {
  const m = await detectMetrics(await project('MZ', { system: (s) => { s.advanced = { uiAreaWidth: 1280, fontSize: 24 }; } }));
  expect(m.boxWidth).toBe(1272);
  expect(m.fontSize).toBe(24);
  expect(m.engine).toBe('MZ');
});

test('MZ: advanced 가 없으면 기본값', async () => {
  expect(await detectMetrics(await project('MZ'))).toEqual(DEFAULT_METRICS.MZ);
});

test('MV: 켜진 YEP_CoreEngine 만 반영하고 숫자가 아니면 무시', async () => {
  const on = await detectMetrics(await project('MV', { plugins: [yep(true, { 'Screen Width': '1280', 'Font Size': '24' })] }));
  expect(on.boxWidth).toBe(1280);
  expect(on.fontSize).toBe(24);
  const off = await detectMetrics(await project('MV', { plugins: [yep(false, { 'Screen Width': '1280', 'Font Size': '24' })] }));
  expect(off).toEqual(DEFAULT_METRICS.MV);
  const bad = await detectMetrics(await project('MV', { plugins: [yep(true, { 'Screen Width': 'abc', 'Font Size': 'abc' })] }));
  expect(bad).toEqual(DEFAULT_METRICS.MV);
});

test('MV: Community_Basic 의 screenWidth', async () => {
  const m = await detectMetrics(await project('MV', { plugins: [{ name: 'Community_Basic', status: true, description: '', parameters: { screenWidth: '1104' } }] }));
  expect(m.boxWidth).toBe(1104);
  const zero = await detectMetrics(await project('MV', { plugins: [{ name: 'Community_Basic', status: true, description: '', parameters: { screenWidth: '0' } }] }));
  expect(zero.boxWidth).toBe(816);
});

test('쓸 수 있는 폭', () => {
  expect(availableWidth(DEFAULT_METRICS.MV, false)).toBe(768);
  expect(availableWidth(DEFAULT_METRICS.MV, true)).toBe(600);
  expect(availableWidth(DEFAULT_METRICS.MZ, false)).toBe(768);
  expect(availableWidth(DEFAULT_METRICS.MZ, true)).toBe(604);
});

test('effectiveMetrics 는 overrides 값만 덮고, 설정은 저장 후 다시 읽어도 같다', async () => {
  const e = effectiveMetrics(DEFAULT_METRICS.MV, { fontSize: 22 });
  expect(e).toEqual({ ...DEFAULT_METRICS.MV, fontSize: 22 });
  const proj = await project('MZ');
  expect(await loadPreviewSettings(proj)).toEqual({ fontPath: null, fontName: null, overrides: {} });
  const s = { fontPath: 'C:/Windows/Fonts/malgun.ttf', fontName: '맑은 고딕', overrides: { boxWidth: 700, maxLines: 3 } };
  await savePreviewSettings(proj, s);
  expect(await loadPreviewSettings(proj)).toEqual(s);
});
