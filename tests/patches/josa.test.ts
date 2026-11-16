import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeEach, expect, test } from 'vitest';
import { applyTranslationsDetailed } from '../../src/core/build/apply.js';
import { patchStatuses } from '../../src/core/patches/apply.js';
import { findJosaConflicts, JOSA_PLUGIN_JS, JOSA_PLUGIN_NAME, josaConflictsIn } from '../../src/core/patches/josa.js';
import type { Patch, PatchBody } from '../../src/core/patches/types.js';
import { openProject, originalDir } from '../../src/core/project/project.js';
import { rebasePatch } from '../../src/core/update/rebase.js';
import { cleanupTempDirs } from '../helpers/fs.js';
import { setupProject } from '../helpers/project.js';
import type { TextUnit } from '../../src/core/types.js';
import type { TranslationStore } from '../../src/core/store/translations.js';

afterAll(cleanupTempDirs);

let proj: string;
let units: TextUnit[];
let store: TranslationStore;
let jsDir: string;
beforeEach(async () => {
  ({ proj, units, store } = await setupProject());
  jsDir = path.join(originalDir(proj, await openProject(proj)), 'js');
});

let seq = 0;
const patch = (body: PatchBody, o: Partial<Patch> = {}): Patch => ({
  id: `p${++seq}`, title: 't', note: '', enabled: true, originalBug: false, createdBy: 'user', createdAt: '', body, ...o,
});
const JOSA = (): Patch => patch({ kind: 'josa' });
const pluginsDir = () => path.join(jsDir, 'plugins');

test('켜면 플러그인 파일이 들어가고 plugins.js 맨 뒤, 다른 plugin 수정보다도 뒤에 붙는다', async () => {
  const other = patch({ kind: 'plugin', name: 'KoreanFont', js: '// x', parameters: {}, description: '폰트' });
  const { files } = await applyTranslationsDetailed(proj, units, store, { patches: [JOSA(), other] });
  expect(files.get(`js/plugins/${JOSA_PLUGIN_NAME}.js`)).toBe(JOSA_PLUGIN_JS);
  const text = files.get('js/plugins.js')!;
  const font = text.indexOf('"KoreanFont"');
  const josa = text.indexOf(`"${JOSA_PLUGIN_NAME}"`);
  expect(font).toBeGreaterThan(0);
  expect(josa).toBeGreaterThan(font);
  expect(text).toContain(`{"name":"${JOSA_PLUGIN_NAME}","status":true,"description":`);
  expect(text.trimEnd().endsWith(`"parameters":{}}];`)).toBe(true);
});

test('끄면 빠진다', async () => {
  const { files } = await applyTranslationsDetailed(proj, units, store, { patches: [patch({ kind: 'josa' }, { enabled: false })] });
  expect(files.has(`js/plugins/${JOSA_PLUGIN_NAME}.js`)).toBe(false);
  expect(files.get('js/plugins.js') ?? '').not.toContain(JOSA_PLUGIN_NAME);
});

test('같은 이름의 파일이 게임에 있으면 충돌', async () => {
  expect((await patchStatuses(proj, [JOSA()]))[0]).toMatchObject({ state: 'applied' });
  await mkdir(pluginsDir(), { recursive: true });
  await writeFile(path.join(pluginsDir(), `${JOSA_PLUGIN_NAME}.js`), '');
  expect((await patchStatuses(proj, [JOSA()]))[0]).toMatchObject({ state: 'conflict', reason: '같은 이름의 플러그인이 이미 있어요' });
  const { files } = await applyTranslationsDetailed(proj, units, store, { patches: [JOSA()] });
  expect(files.has(`js/plugins/${JOSA_PLUGIN_NAME}.js`)).toBe(false);
});

test('게임 업데이트를 가져와도 그대로 남는다', () => {
  const p = JOSA();
  expect(rebasePatch(p, { describe: () => '' })).toEqual({ result: 'unchanged', patch: p });
});

const REPLACE_FORMAT = `String.prototype.format = function() { return this; };`;
const WRAP_ESCAPE = `var _old = Window_Base.prototype.convertEscapeCharacters;\nWindow_Base.prototype.convertEscapeCharacters = function(text) { return _old.call(this, text); };`;
const REPLACE_ESCAPE = `Window_Base.prototype.convertEscapeCharacters = function(text) {\n  return text.replace(/\\\\N/g, '');\n};`;
const HELPER_ONLY = `var convertEscapeCharacters = function(text) { return text; };\nfunction format() {}`;
const YEP_STYLE = `Yanfly.Message.Window_Base_convertEscapeCharacters = Window_Base.prototype.convertEscapeCharacters;\nWindow_Base.prototype.convertEscapeCharacters = function(text) {\n  text = Yanfly.Message.Window_Base_convertEscapeCharacters.call(this, text);\n  return text;\n};`;

test('통째로 바꾸는 것만 찾는다', () => {
  expect(josaConflictsIn(REPLACE_FORMAT)).toBe(true);
  expect(josaConflictsIn(REPLACE_ESCAPE)).toBe(true);
  expect(josaConflictsIn(WRAP_ESCAPE)).toBe(false);
  expect(josaConflictsIn(YEP_STYLE)).toBe(false);
  expect(josaConflictsIn(HELPER_ONLY)).toBe(false);
  expect(josaConflictsIn('if (String.prototype.format == null) {}')).toBe(false);
});

test('켜진 플러그인 파일에서 부딪히는 것의 이름을 준다', async () => {
  await mkdir(pluginsDir(), { recursive: true });
  const list = [
    { name: 'Replace', status: true, description: '', parameters: {} },
    { name: 'Wrap', status: true, description: '', parameters: {} },
    { name: 'Off', status: false, description: '', parameters: {} },
    { name: 'Helper', status: true, description: '', parameters: {} },
    { name: 'Missing', status: true, description: '', parameters: {} },
  ];
  await writeFile(path.join(jsDir, 'plugins.js'), `var $plugins =\n${JSON.stringify(list)};\n`);
  await writeFile(path.join(pluginsDir(), 'Replace.js'), REPLACE_ESCAPE);
  await writeFile(path.join(pluginsDir(), 'Wrap.js'), WRAP_ESCAPE);
  await writeFile(path.join(pluginsDir(), 'Off.js'), REPLACE_FORMAT);
  await writeFile(path.join(pluginsDir(), 'Helper.js'), HELPER_ONLY);
  expect(await findJosaConflicts(proj)).toEqual(['Replace']);
  // read only: the original copy is not touched
  expect(await readFile(path.join(pluginsDir(), 'Off.js'), 'utf8')).toBe(REPLACE_FORMAT);
});

test('plugins.js 가 없으면 빈 목록', async () => {
  const { rm } = await import('node:fs/promises');
  await rm(path.join(jsDir, 'plugins.js'), { force: true });
  expect(await findJosaConflicts(proj)).toEqual([]);
});
