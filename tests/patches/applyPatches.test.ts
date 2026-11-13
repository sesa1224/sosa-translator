import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeEach, expect, test } from 'vitest';
import { applyTranslations, applyTranslationsDetailed } from '../../src/core/build/apply.js';
import { patchStatuses } from '../../src/core/patches/apply.js';
import { listHash } from '../../src/core/patches/hash.js';
import { savePatches } from '../../src/core/patches/store.js';
import type { EventCommand, ListOp, Patch, PatchBody } from '../../src/core/patches/types.js';
import type { TranslationStore } from '../../src/core/store/translations.js';
import type { TextUnit } from '../../src/core/types.js';
import { cleanupTempDirs } from '../helpers/fs.js';
import { miniMap, PLUGINS_JS_TEXT } from '../helpers/miniGame.js';
import { setupProject, translator } from '../helpers/project.js';

afterAll(cleanupTempDirs);

let proj: string;
let units: TextUnit[];
let store: TranslationStore;
let tr: ReturnType<typeof translator>;

beforeEach(async () => {
  ({ proj, units, store } = await setupProject());
  tr = translator(units, store);
});

const LIST_PATH = ['events', 1, 'pages', 0, 'list'];
const baseList = () => miniMap('MZ').events[1]!.pages[0].list as EventCommand[];
const SW45: EventCommand = { code: 121, indent: 0, parameters: [45, 45, 0] };

let seq = 0;
function patch(body: PatchBody, o: Partial<Patch> = {}): Patch {
  return { id: `p${++seq}`, title: '수정', note: '', enabled: true, originalBug: false, createdBy: 'user', createdAt: '2026-11-13T00:00:00.000Z', body, ...o };
}
const eventPatch = (ops: ListOp[], o: Partial<Patch> = {}, hash = listHash(baseList())) =>
  patch({ kind: 'event', file: 'data/Map001.json', listPath: LIST_PATH, baseHash: hash, ops }, o);

function translateAll(): void {
  tr('あれ？\\N[1]じゃない！\nこんな夜に来るなんて', '어라?\n\\N[1] 아니야!\n이런 밤에 오다니');
  tr('やった！', '해냈다!'); tr('いいよ', '좋아'); tr('また今度', '다음에');
}

const mapList = (files: Map<string, string>) => JSON.parse(files.get('data/Map001.json')!).events[1].pages[0].list;

test('수정이 없으면 결과가 글자 하나까지 같다', async () => {
  translateAll();
  tr('月光草', '월광초');
  const before = await applyTranslations(proj, units, store, { patches: [] } as never);
  const viaFile = await applyTranslations(proj, units, store);
  const off = await applyTranslationsDetailed(proj, units, store, { patches: [eventPatch([{ op: 'delete', at: 11 }], { enabled: false })] });
  expect([...viaFile]).toEqual([...before]);
  expect([...off.files]).toEqual([...before]);
});

test('대사 앞에 2개를 끼워 넣어도 번역이 제자리에 들어간다', async () => {
  translateAll();
  const a: EventCommand = { code: 230, indent: 0, parameters: [30] };
  const { files } = await applyTranslationsDetailed(proj, units, store, { patches: [eventPatch([{ op: 'insert', after: -1, commands: [a, SW45] }])] });
  const list = mapList(files);
  expect(list.slice(0, 2)).toEqual([a, SW45]);
  const rest = list.slice(2);
  expect(rest.map((c: any) => c.code)).toEqual([101, 401, 401, 401, 102, 402, 101, 401, 0, 402, 0, 404, 356, 0]);
  expect(rest.slice(1, 4).map((c: any) => c.parameters[0])).toEqual(['어라?', '\\N[1] 아니야!', '이런 밤에 오다니']);
  expect(rest[4].parameters[0]).toEqual(['좋아', '다음에']);
  expect(rest[5].parameters).toEqual([0, '좋아']); expect(rest[9].parameters).toEqual([1, '다음에']);
  expect(rest[7]).toEqual({ code: 401, indent: 1, parameters: ['해냈다!'] });
});

test('앞의 커맨드를 지워도 뒤의 번역과 MZ 화자가 제자리에 들어간다', async () => {
  translateAll();
  tr('リナ', '리나');
  const { files } = await applyTranslationsDetailed(proj, units, store, { patches: [eventPatch([{ op: 'delete', at: 11 }, { op: 'insert', after: 3, commands: [SW45] }])] });
  const list = mapList(files);
  expect(list.map((c: any) => c.code)).toEqual([101, 401, 401, 401, 102, 121, 402, 101, 401, 0, 402, 0, 404, 0]);
  expect(list[7].parameters[4]).toBe('리나');
  expect(list[0].parameters[4]).toBe('리나');
});

test('수정만 있고 번역이 없어도 맵 파일이 결과에 있다', async () => {
  const { files } = await applyTranslationsDetailed(proj, units, store, { patches: [eventPatch([{ op: 'insert', after: 12, commands: [SW45] }])] });
  expect([...files.keys()]).toEqual(['data/Map001.json']);
  expect(mapList(files).at(-1)).toEqual(SW45);
});

test('번역이 걸린 401 을 지우면 그 대사 번역은 건너뛰고 다른 번역은 들어간다', async () => {
  translateAll();
  const { files } = await applyTranslationsDetailed(proj, units, store, { patches: [eventPatch([{ op: 'delete', at: 2 }])] });
  const list = mapList(files);
  expect(list.slice(0, 2).map((c: any) => c.parameters[0])).toEqual(['', 'あれ？\\N[1]じゃない！']);
  expect(list[2].parameters[0]).toEqual(['좋아', '다음에']);
  expect(list.find((c: any) => c.code === 401 && c.indent === 1).parameters[0]).toBe('해냈다!');
});

test('baseHash 가 다르면 충돌이고 적용되지 않는다', async () => {
  translateAll();
  const p = eventPatch([{ op: 'insert', after: -1, commands: [SW45] }], {}, 'ffff');
  expect(await patchStatuses(proj, [p])).toEqual([{ id: p.id, state: 'conflict', reason: '원본 이벤트가 기록했을 때와 달라졌어요' }]);
  const plain = await applyTranslations(proj, units, store, { patches: [] } as never);
  const { files } = await applyTranslationsDetailed(proj, units, store, { patches: [p] });
  expect([...files]).toEqual([...plain]);
});

test('없는 이벤트와 잘못된 연산은 충돌', async () => {
  const gone = patch({ kind: 'event', file: 'data/Map001.json', listPath: ['events', 7, 'pages', 0, 'list'], baseHash: 'x', ops: [] });
  const bad = eventPatch([{ op: 'delete', at: 99 }]);
  const st = await patchStatuses(proj, [gone, bad]);
  expect(st[0]).toEqual({ id: gone.id, state: 'conflict', reason: '원본에 그 이벤트가 없어요' });
  expect(st[1].state).toBe('conflict');
  expect(st[1].reason).toContain('범위');
});

test('json 수정이 System.json 에 들어가고 baseValue 가 다르면 충돌', async () => {
  const sys = JSON.parse(await readFile(path.join(proj, 'original', 'v1', 'data', 'System.json'), 'utf8'));
  sys.advanced = { fontSize: 26, mainFontFilename: 'mplus-1m-regular.woff' };
  await writeFile(path.join(proj, 'original', 'v1', 'data', 'System.json'), JSON.stringify(sys));
  tr('霧の薬草園', '안개 약초원');
  const ok = patch({ kind: 'json', file: 'data/System.json', path: ['advanced', 'fontSize'], baseValue: 26, value: 22 });
  const stale = patch({ kind: 'json', file: 'data/System.json', path: ['advanced', 'fontSize'], baseValue: 28, value: 20 });
  const { files } = await applyTranslationsDetailed(proj, units, store, { patches: [ok, stale] });
  const out = JSON.parse(files.get('data/System.json')!);
  expect(out.advanced.fontSize).toBe(22);
  expect(out.gameTitle).toBe('안개 약초원');
  expect((await patchStatuses(proj, [ok, stale])).map((s) => s.state)).toEqual(['applied', 'conflict']);
});

test('plugin 수정은 plugins.js 목록 끝에 더해진다', async () => {
  const p = patch({ kind: 'plugin', name: 'KoreanFont', js: '// x', parameters: { size: '24' }, description: '한글 폰트' });
  const { files } = await applyTranslationsDetailed(proj, units, store, { patches: [p] });
  const text = files.get('js/plugins.js')!;
  const head = PLUGINS_JS_TEXT.slice(0, PLUGINS_JS_TEXT.lastIndexOf('}]') + 1);
  expect(text.startsWith(head)).toBe(true);
  expect(text).toContain(',{"name":"KoreanFont","status":true,"description":"한글 폰트","parameters":{"size":"24"}}];');
  expect((await patchStatuses(proj, [patch({ kind: 'plugin', name: 'Menu', js: '', parameters: {}, description: '' })]))[0])
    .toMatchObject({ state: 'applied' });
});

test('같은 이름의 플러그인 파일이 원본에 있으면 충돌, 폰트 파일이 없으면 충돌', async () => {
  const { mkdir } = await import('node:fs/promises');
  await mkdir(path.join(proj, 'original', 'v1', 'js', 'plugins'), { recursive: true });
  await writeFile(path.join(proj, 'original', 'v1', 'js', 'plugins', 'Dup.js'), '');
  const st = await patchStatuses(proj, [
    patch({ kind: 'plugin', name: 'Dup', js: '', parameters: {}, description: '' }),
    patch({ kind: 'font', fontPath: path.join(proj, 'none.ttf'), subset: true }),
    patch({ kind: 'font', fontPath: path.join(proj, 'none.ttf'), subset: true }, { enabled: false }),
  ]);
  expect(st.map((s) => [s.state, s.reason])).toEqual([
    ['conflict', '같은 이름의 플러그인이 이미 있어요'], ['conflict', '폰트 파일을 찾을 수 없어요'], ['disabled', undefined],
  ]);
});

test('patches.json 을 스스로 읽고, 꺼진 수정은 적용하지 않는다', async () => {
  await savePatches(proj, [eventPatch([{ op: 'insert', after: -1, commands: [SW45] }]), eventPatch([{ op: 'delete', at: 0 }], { enabled: false })]);
  const files = await applyTranslations(proj, units, store);
  const list = mapList(files);
  expect(list[0]).toEqual(SW45);
  expect(list[1].code).toBe(101);
});

test('결과 어디에도 __o 가 없다', async () => {
  translateAll();
  tr('むかしむかし', '옛날 옛적에');
  const { files } = await applyTranslationsDetailed(proj, units, store, { patches: [eventPatch([{ op: 'replace', at: 11, commands: [SW45] }])] });
  for (const text of files.values()) expect(text).not.toContain('__o');
});
