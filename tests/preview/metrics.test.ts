import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { createProject } from '../../src/core/project/project.js';
import {
  availableWidth, DEFAULT_METRICS, detectMetrics, effectiveMetrics, loadPreviewSettings, savePreviewSettings,
} from '../../src/core/preview/metrics.js';
import { detectedLimits, windowLimits } from '../../src/core/preview/windows.js';
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
  // MV: Window_Message draws from x 0 (168 with a face) of contents 816 - 18 * 2 wide.
  expect(availableWidth(DEFAULT_METRICS.MV, false)).toBe(780);
  expect(availableWidth(DEFAULT_METRICS.MV, true)).toBe(612);
  expect(availableWidth(DEFAULT_METRICS.MZ, false)).toBe(768);
  expect(availableWidth(DEFAULT_METRICS.MZ, true)).toBe(604);
});

test('창 종류별 기준: 감지한 값, 설명창 기본 2줄, 덮어쓴 값', () => {
  // MV help window: drawTextEx at textPadding (6), clipped at the contents width 816 - 36.
  expect(detectedLimits(DEFAULT_METRICS.MV)).toEqual({ message: { width: 780, maxLines: 4, fontSize: 28 }, help: { width: 774, maxLines: 2, fontSize: 28 } });
  // Metrics made before the help fields existed still give a help window.
  const { helpWidth: _w, helpMaxLines: _l, helpFontSize: _f, ...old } = DEFAULT_METRICS.MZ;
  expect(detectedLimits(old).help).toEqual({ width: 768, maxLines: 2, fontSize: 26 });
  const l = windowLimits(DEFAULT_METRICS.MV, { message: { width: 600 }, help: { maxLines: 3 } });
  expect(l.message).toEqual({ width: 600, maxLines: 4, fontSize: 28 });
  expect(l.help).toEqual({ width: 774, maxLines: 3, fontSize: 28 });
  expect(windowLimits(DEFAULT_METRICS.MV, { message: { width: -1, maxLines: 0 } }).message.width).toBe(780);
});

const msgCore = (params: Record<string, string>) => ({ name: 'YEP_MessageCore', status: true, description: '', parameters: params });

test('MV: YEP_MessageCore 의 너비·줄 수·글자 크기·얼굴 밀림과 YEP_CoreEngine 의 여백·얼굴 너비', async () => {
  // The game the feature was made for: Community_Basic (800) loads before YEP_CoreEngine (1280), which wins.
  const m = await detectMetrics(await project('MV', { plugins: [
    { name: 'Community_Basic', status: true, description: '', parameters: { screenWidth: '800' } },
    yep(true, { 'Screen Width': '1280', 'Font Size': '28', 'Window Padding': '18', 'Text Padding': '18', 'Face Width': '144', 'Line Height': '36', 'Icon Width': '32' }),
    msgCore({ 'Default Rows': '3', 'Default Width': '800', 'Face Indent': 'Window_Base._faceWidth + 24', 'Font Size': '28', 'Word Wrapping': 'false' }),
  ] }));
  expect(m.boxWidth).toBe(800);
  expect(m.maxLines).toBe(3);
  expect(m.faceIndent).toBe(168);
  expect(m.textPadding).toBe(18);
  expect(availableWidth(m, false)).toBe(764);
  expect(availableWidth(m, true)).toBe(596);
  // The help window spans the screen: 1280 - 18 * 2 - 18.
  expect(detectedLimits(m).help).toEqual({ width: 1226, maxLines: 2, fontSize: 28 });
});

test('MV: 플러그인 순서대로 나중 것이 이긴다, 식은 아는 꼴만 읽는다', async () => {
  const later = await detectMetrics(await project('MV', { plugins: [
    yep(true, { 'Screen Width': '1280' }),
    { name: 'Community_Basic', status: true, description: '', parameters: { screenWidth: '1104' } },
  ] }));
  expect(later.boxWidth).toBe(1104);
  // Default Width left at Graphics.boxWidth; message font apart from the base font; a face width the indent follows.
  const m = await detectMetrics(await project('MV', { plugins: [
    yep(true, { 'Screen Width': '1000', 'Font Size': '24', 'Face Width': '120' }),
    msgCore({ 'Default Rows': '4', 'Default Width': 'Graphics.boxWidth', 'Face Indent': 'Window_Base._faceWidth + 24', 'Font Size': '30' }),
  ] }));
  expect(m.boxWidth).toBe(1000);
  expect(m.fontSize).toBe(30);
  expect(m.helpFontSize).toBe(24);
  expect(m.faceIndent).toBe(144);
  // An expression the program cannot read keeps the screen width.
  const odd = await detectMetrics(await project('MV', { plugins: [msgCore({ 'Default Width': 'Math.min(Graphics.boxWidth, 700)' })] }));
  expect(odd.boxWidth).toBe(816);
  // Without YEP_MessageCore the engine indents by 168 whatever the face width.
  const plain = await detectMetrics(await project('MV', { plugins: [yep(true, { 'Face Width': '120' })] }));
  expect(plain.faceIndent).toBe(168);
});

test('preview.json: 창별 덮어쓰기를 저장하고, 옛 파일은 그대로 읽힌다', async () => {
  const proj = await project('MV');
  await writeFile(path.join(proj, 'preview.json'), JSON.stringify({ fontPath: null, fontName: null, overrides: { boxWidth: 700 } }), 'utf8');
  expect(await loadPreviewSettings(proj)).toEqual({ fontPath: null, fontName: null, overrides: { boxWidth: 700 } });
  const s = { fontPath: null, fontName: null, overrides: {}, windows: { message: { width: 600 }, help: { maxLines: 3, width: 0 } } };
  await savePreviewSettings(proj, s);
  expect(await loadPreviewSettings(proj)).toEqual({ fontPath: null, fontName: null, overrides: {}, windows: { message: { width: 600 }, help: { maxLines: 3 } } });
  await savePreviewSettings(proj, { fontPath: null, fontName: null, overrides: {}, windows: {} });
  expect(JSON.parse(await readFile(path.join(proj, 'preview.json'), 'utf8'))).toEqual({ fontPath: null, fontName: null, overrides: {} });
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
