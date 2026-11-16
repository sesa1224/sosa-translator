import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { listHash } from '../../src/core/patches/hash.js';
import { JOSA_PLUGIN_NAME } from '../../src/core/patches/josa.js';
import type { EventCommand, Patch, PatchBody } from '../../src/core/patches/types.js';
import { ProjectService } from '../../src/main/projectService.js';
import { callTool, TOOL_DEFS } from '../../src/main/toolHandlers.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';
import { miniMap } from '../helpers/miniGame.js';
import { makeTestFont } from '../helpers/testFont.js';
import { freshGame } from './helpers.js';

let svc: ProjectService;
const LIST_PATH = ['events', 1, 'pages', 0, 'list'];
const HASH = listHash(miniMap('MZ').events[1]!.pages[0].list);
const SW45: EventCommand = { code: 121, indent: 0, parameters: [45, 45, 0] };
const insertBody = (baseHash = HASH): PatchBody => ({ kind: 'event', file: 'data/Map001.json', listPath: LIST_PATH, baseHash, ops: [{ op: 'insert', after: 11, commands: [SW45] }] });

beforeEach(async () => {
  const { game, proj } = await freshGame();
  svc = await ProjectService.create(game, proj, '약초원');
  // Name for switch 45, so the described lines carry it.
  const sysFile = path.join(proj, 'original', 'v1', 'data', 'System.json');
  const sys = JSON.parse(await readFile(sysFile, 'utf8'));
  sys.switches = [];
  sys.switches[45] = '기록1 완료';
  await writeFile(sysFile, JSON.stringify(sys));
});
afterEach(async () => { await svc.close(); });
afterAll(cleanupTempDirs);

const mapListIn = async (zipPath: string) => {
  const zip = unzipSync(await readFile(zipPath));
  return JSON.parse(strFromU8(zip['data/Map001.json'])).events[1].pages[0].list as EventCommand[];
};

test('addPatch 는 저장하고 알리고, 빌드 결과에 들어간다', async () => {
  const seen: Patch[][] = [];
  svc.on('patches-changed', (p) => seen.push(p));
  const p = await svc.addPatch({ title: '스위치 켜기', body: insertBody() }, 'user');
  expect(p).toMatchObject({ title: '스위치 켜기', note: '', enabled: true, originalBug: false, createdBy: 'user' });
  expect(JSON.parse(await readFile(path.join(svc.projectDir, 'patches.json'), 'utf8'))).toHaveLength(1);
  expect(seen).toHaveLength(1);
  expect(seen[0][0].id).toBe(p.id);
  const r = await svc.build();
  expect((await mapListIn(r.zipPath))[12]).toEqual(SW45);
  expect(await svc.patchStatuses()).toEqual([{ id: p.id, state: 'applied' }]);
});

test('틀린 baseHash 는 거절, 비우면 채워진다', async () => {
  await expect(svc.addPatch({ title: 'x', body: insertBody('abc') }, 'user')).rejects.toThrow('원본 이벤트가 기록했을 때와 달라졌어요');
  const p = await svc.addPatch({ title: 'x', body: insertBody('') }, 'user');
  expect((p.body as Extract<PatchBody, { kind: 'event' }>).baseHash).toBe(HASH);
});

test('같은 목록에 두 번째 수정은 오류, 첫 수정을 끄면 넣을 수 있다', async () => {
  const first = await svc.addPatch({ title: '1', body: insertBody() }, 'user');
  await expect(svc.addPatch({ title: '2', body: insertBody() }, 'user')).rejects.toThrow('이 이벤트에는 이미 수정이 있습니다. 그 수정을 고치세요');
  await svc.updatePatch(first.id, { enabled: false });
  await svc.addPatch({ title: '2', body: insertBody() }, 'user');
  expect(svc.patches()).toHaveLength(2);
});

test('수정을 끄면 다음 빌드에서 빠지고, 지울 수 있다', async () => {
  const p = await svc.addPatch({ title: '1', body: insertBody() }, 'user');
  await svc.updatePatch(p.id, { enabled: false, title: '고친 제목', originalBug: true });
  expect(svc.patches()[0]).toMatchObject({ enabled: false, title: '고친 제목', originalBug: true });
  await expect(svc.build()).rejects.toThrow('바뀐 파일이 없습니다');
  await svc.removePatch(p.id);
  expect(svc.patches()).toEqual([]);
});

test('setGameFontPatch 는 font 수정을 하나만 유지한다', async () => {
  const dir = await makeTempDir();
  const a = await makeTestFont(dir, { name: 'A', glyphs: { '가': 1000 } });
  const b = await makeTestFont(dir, { name: 'B', glyphs: { '가': 1000 } });
  await svc.setGameFontPatch(a, true);
  await svc.setGameFontPatch(b, false);
  const fonts = svc.patches().filter((p) => p.body.kind === 'font');
  expect(fonts).toHaveLength(1);
  expect(fonts[0].body).toEqual({ kind: 'font', fontPath: b, subset: false });
  await svc.setGameFontPatch(null, true);
  expect(svc.patches()).toEqual([]);
});

test('setJosaPatch 는 조사 수정을 하나만 두고, 빌드에 플러그인이 들어간다', async () => {
  await svc.setJosaPatch(true, 'user');
  await svc.setJosaPatch(true, 'user');
  const josa = svc.patches().filter((p) => p.body.kind === 'josa');
  expect(josa).toHaveLength(1);
  expect(josa[0]).toMatchObject({ title: '조사 자동 맞춤', enabled: true, body: { kind: 'josa' } });
  await expect(svc.addPatch({ title: 'x', body: { kind: 'josa' } }, 'claude')).rejects.toThrow('이미');
  const r = await svc.build();
  const zip = unzipSync(await readFile(r.zipPath));
  expect(Object.keys(zip)).toContain(`js/plugins/${JOSA_PLUGIN_NAME}.js`);
  expect(strFromU8(zip['js/plugins.js'])).toContain(`"name":"${JOSA_PLUGIN_NAME}"`);
  expect(await svc.josaConflicts()).toEqual([]);
  await svc.setJosaPatch(false, 'user');
  expect(svc.patches()).toEqual([]);
});

test('조사 수정이 꺼져 있으면 켜면서 다시 켠다', async () => {
  await svc.setJosaPatch(true, 'user');
  const id = svc.patches()[0].id;
  await svc.updatePatch(id, { enabled: false });
  await svc.setJosaPatch(true, 'claude');
  expect(svc.patches()).toMatchObject([{ id, enabled: true }]);
});

test('채팅 도구: set_josa_plugin 은 켜고 끄고 부딪히는 플러그인을 알려 준다', async () => {
  const on = (await callTool(svc, 'set_josa_plugin', { enabled: true })) as any;
  expect(on).toEqual({ ok: true, data: { enabled: true, state: 'applied', conflictingPlugins: [] } });
  expect(svc.patches()[0].createdBy).toBe('claude');
  const off = (await callTool(svc, 'set_josa_plugin', { enabled: false })) as any;
  expect(off).toEqual({ ok: true, data: { enabled: false, conflictingPlugins: [] } });
  expect(svc.patches()).toEqual([]);
});

test('채팅 도구: event_read 는 풀어쓴 줄과 해시를 주고 원본 JSON 은 raw 일 때만', async () => {
  expect(TOOL_DEFS.map((t) => t.name)).toEqual(expect.arrayContaining(['event_files', 'event_list', 'event_read', 'usage_search', 'event_patch']));
  const files = (await callTool(svc, 'event_files', {})) as any;
  expect(files.data.files.map((f: any) => f.file)).toContain('data/Map001.json');
  const list = (await callTool(svc, 'event_list', { file: 'data/Map001.json' })) as any;
  expect(list.data.events[0].listPath).toEqual(LIST_PATH);
  const r = (await callTool(svc, 'event_read', { file: 'data/Map001.json', listPath: LIST_PATH })) as any;
  expect(r.ok).toBe(true);
  expect(r.data.hash).toBe(HASH);
  expect(r.data.lines[0]).toEqual({ index: 0, indent: 0, text: '대사 [リナ] あれ？\\N[1]じゃない！ / こんな夜に来るなんて' });
  expect(JSON.stringify(r.data)).not.toContain('"parameters"');
  const raw = (await callTool(svc, 'event_read', { file: 'data/Map001.json', listPath: LIST_PATH, raw: true, from: 1, to: 2 })) as any;
  expect(raw.data.raw).toEqual([{ index: 1, code: 401, indent: 0, parameters: ['あれ？\\N[1]じゃない！'] }, { index: 2, code: 401, indent: 0, parameters: ['こんな夜に来るなんて'] }]);
  const big = (await callTool(svc, 'event_read', { file: 'data/Map001.json', listPath: LIST_PATH, raw: true, from: 0, to: 100 })) as any;
  expect(big.data.raw.length).toBeLessThanOrEqual(30);
});

test('채팅 도구: event_patch 는 claude 의 수정을 만들고, 다시 하면 ops 를 바꾼다', async () => {
  const body = { title: '스위치 켜기', file: 'data/Map001.json', listPath: LIST_PATH, baseHash: HASH, ops: [{ op: 'insert', after: 11, commands: [SW45] }], originalBug: true };
  const r = (await callTool(svc, 'event_patch', body)) as any;
  expect(r.ok).toBe(true);
  expect(svc.patches()).toHaveLength(1);
  expect(svc.patches()[0]).toMatchObject({ createdBy: 'claude', originalBug: true });
  const r2 = (await callTool(svc, 'event_patch', { ...body, ops: [{ op: 'insert', after: 10, commands: [SW45] }] })) as any;
  expect(r2.ok).toBe(true);
  expect(svc.patches()).toHaveLength(1);
  expect((svc.patches()[0].body as any).ops[0].after).toBe(10);
  const bad = (await callTool(svc, 'event_patch', { ...body, ops: [{ op: 'delete', at: 99 }] })) as any;
  expect(bad.ok).toBe(false);
  const usage = (await callTool(svc, 'usage_search', { type: 'switch', id: 45 })) as any;
  expect(usage.ok).toBe(true);
  expect(usage.data.total).toBe(0);
});

test('creatorReport 는 원본 버그인 수정만 담고 풀어쓴 연산을 보여 준다', async () => {
  await svc.addPatch({ title: '기록 스위치가 안 켜짐', note: '이벤트1 끝에서 켜야 이벤트2가 시작된다', originalBug: true, body: insertBody() }, 'user');
  await svc.addPatch({ title: '글자 크기', body: { kind: 'json', file: 'data/System.json', path: ['gameTitle'], baseValue: '霧の薬草園', value: '안개' } }, 'user');
  const text = await svc.creatorReport();
  expect(text).toContain('기록 스위치가 안 켜짐');
  expect(text).toContain('이벤트1 끝에서 켜야 이벤트2가 시작된다');
  expect(text).toContain('+ 스위치 45 [기록1 완료] = 켬');
  expect(text).toContain('맵1 · 이벤트1 · 1페이지');
  expect(text).not.toContain('글자 크기');
});
