import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { createProject, openProject } from '../../src/core/project/project.js';
import { extractAll, extractFromDir, loadUnits } from '../../src/core/extract/index.js';
import { TranslationStore } from '../../src/core/store/translations.js';
import { savePatches, loadPatches } from '../../src/core/patches/store.js';
import { listHash } from '../../src/core/patches/hash.js';
import { buildPatch } from '../../src/core/build/patch.js';
import { importVersion, inspectNewVersion, readUpdateSummary, rollbackVersion, versionsOf } from '../../src/core/update/importVersion.js';
import type { EventCommand, Patch } from '../../src/core/patches/types.js';
import { cleanupTempDirs, hashDir, makeTempDir } from '../helpers/fs.js';
import { makeMiniGame, miniMap } from '../helpers/miniGame.js';

afterEach(cleanupTempDirs);

const LIST_PATH = ['events', 1, 'pages', 0, 'list'];
const SWITCH: EventCommand = { code: 121, indent: 0, parameters: [5, 5, 0] };

/** v1 project with a few translations and a patch that turns a switch on at the end of the map event. */
async function setup() {
  const v1 = await makeTempDir();
  const v2 = await makeTempDir();
  await makeMiniGame(v1);
  await makeMiniGame(v2, { variant: 'v2' });
  const proj = path.join(await makeTempDir(), 'proj');
  await createProject(v1, proj, '약초원');
  const { units } = await extractAll(proj);
  const store = await TranslationStore.load(proj);
  const tr = (source: string, target: string) => store.set(units.find((u) => u.source === source)!.id, target, 'approved');
  tr('いいよ', '좋아');
  tr('やった！', '해냈다!');
  tr('あれ？\\N[1]じゃない！\nこんな夜に来るなんて', '어라? \\N[1] 아니야!\n이런 밤에 오다니');
  tr('むかしむかし', '옛날 옛적에');
  await store.save();
  const list = miniMap('MZ').events[1]!.pages[0].list as EventCommand[];
  const patch: Patch = {
    id: 'p-sw', title: '끝에 스위치 켜기', note: '', enabled: true, originalBug: true, createdBy: 'user', createdAt: '2026-01-01T00:00:00.000Z',
    body: { kind: 'event', file: 'data/Map001.json', listPath: LIST_PATH, baseHash: listHash(list), ops: [{ op: 'insert', after: list.length - 2, commands: [SWITCH] }] },
  };
  await savePatches(proj, [patch]);
  return { v1, v2, proj };
}

const read = (proj: string, name: string) => readFile(path.join(proj, name), 'utf8');
const FILES = ['project.json', 'units.json', 'translations.json', 'patches.json'];
async function snapshot(proj: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const f of FILES) out[f] = await read(proj, f);
  return out;
}

describe('inspectNewVersion', () => {
  test('같은 게임의 새 버전', async () => {
    const { v2, proj } = await setup();
    const r = await inspectNewVersion(proj, v2);
    expect(r).toMatchObject({ ok: true, engine: 'MZ', title: '霧の薬草園 ver1.1', suggestedLabel: '1.1', sameGame: true, overlap: 1 });
  });
  test('빈 폴더, 같은 폴더, 엔진이 다른 게임', async () => {
    const { v1, proj } = await setup();
    const empty = await makeTempDir();
    expect((await inspectNewVersion(proj, empty)).ok).toBe(false);
    expect(await inspectNewVersion(proj, v1)).toEqual({ ok: false, error: '지금 버전과 같은 폴더예요' });
    const mv = await makeTempDir();
    await makeMiniGame(mv, { engine: 'MV' });
    expect(await inspectNewVersion(proj, mv)).toMatchObject({ ok: true, sameGame: false, reason: '엔진이 달라요(지금 MZ, 새 폴더 MV)' });
  });
  test('데이터 파일이 거의 겹치지 않으면 다른 게임', async () => {
    const { proj } = await setup();
    const other = await makeTempDir();
    await makeMiniGame(other);
    const data = path.join(other, 'data');
    const { readdir, rm } = await import('node:fs/promises');
    for (const n of await readdir(data)) if (n !== 'System.json') await rm(path.join(data, n));
    for (const n of ['A', 'B', 'C']) await writeFile(path.join(data, `${n}.json`), '[]');
    expect(await inspectNewVersion(proj, other)).toMatchObject({ ok: true, sameGame: false, reason: '데이터 파일이 거의 겹치지 않아요' });
  });
  test('버전 표시가 없으면 다음 번호', async () => {
    const { proj } = await setup();
    const plain = await makeTempDir();
    await makeMiniGame(plain);
    const sys = path.join(plain, 'data', 'System.json');
    const j = JSON.parse(await readFile(sys, 'utf8'));
    j.gameTitle = '霧の薬草園 完全版';
    await writeFile(sys, JSON.stringify(j));
    expect(await inspectNewVersion(proj, plain)).toMatchObject({ ok: true, suggestedLabel: 'v2' });
  });
});

describe('importVersion', () => {
  test('번역을 이어받고 바뀐 것과 새 것을 알려 준다', async () => {
    const { v1, v2, proj } = await setup();
    const before = [await hashDir(v1), await hashDir(v2)];
    const summary = await importVersion(proj, v2, '1.1');

    const units = await loadUnits(proj);
    const store = await TranslationStore.load(proj);
    const by = (s: string) => units.find((u) => u.source === s);
    expect(store.get(by('いいよ')!.id).target).toBe('좋아');

    const changedLine = by('あれ？\\N[1]じゃない！\nこんな夜更けに来るなんて')!;
    const e = store.get(changedLine.id);
    expect(e.target).toBeNull();
    expect(e.previous).toEqual({ source: 'あれ？\\N[1]じゃない！\nこんな夜に来るなんて', target: '어라? \\N[1] 아니야!\n이런 밤에 오다니', version: 'v1' });

    expect(store.get(by('やった！！')!.id)).toMatchObject({ target: '해냈다!', status: 'needs-review', carried: true });
    expect(by('星の砂')).toBeDefined();
    expect(by('むかしむかし')).toBeUndefined();
    expect(Object.values(store.entries()).some((x) => x.target === '옛날 옛적에')).toBe(true);

    expect(summary).toMatchObject({ from: 'v1', to: 'v2', fromLabel: 'v1', toLabel: '1.1', added: 2, changed: 3, carried: 1, removed: 1, removedTranslated: 1 });
    expect(summary.kept).toBe(units.length - 2 - 3);
    expect(summary.keptTranslated).toBe(1);
    expect(summary.patches).toEqual([{ id: 'p-sw', title: '끝에 스위치 켜기', result: 'moved' }]);
    expect(await readUpdateSummary(proj)).toEqual(summary);
    expect(await readUpdateSummary(proj, 'v2')).toEqual(summary);

    const meta = await openProject(proj);
    expect(meta.current).toBe('v2');
    expect(path.resolve(meta.gameDir)).toBe(path.resolve(v2));
    expect(meta.versions[1]).toMatchObject({ id: 'v2', label: '1.1', gameDir: path.resolve(v2) });
    expect(versionsOf(meta).map((v) => v.label)).toEqual(['v1', '1.1']);

    // The patch moved one down: the switch is still at the end, before the closing command.
    const build = await buildPatch(proj, units, store);
    const zip = unzipSync(new Uint8Array(await readFile(build.zipPath)));
    const map = JSON.parse(strFromU8(zip['data/Map001.json']));
    const list = map.events[1].pages[0].list as EventCommand[];
    expect(list[0].code).toBe(230);
    expect(list[list.length - 2]).toEqual(SWITCH);
    expect(list[list.length - 3].code).toBe(356);
    expect(list[list.length - 1].code).toBe(0);
    expect(list.find((c) => c.code === 401 && c.parameters[0] === '해냈다!')).toBeDefined();

    expect([await hashDir(v1), await hashDir(v2)]).toEqual(before);
  });

  test('되돌리면 가져오기 전과 글자 하나까지 같다', async () => {
    const { v2, proj } = await setup();
    const before = await snapshot(proj);
    await importVersion(proj, v2, '1.1');
    expect(await rollbackVersion(proj)).toEqual({ restored: 'v1' });
    expect(await snapshot(proj)).toEqual(before);
    expect(existsSync(path.join(proj, 'original', 'v2'))).toBe(false);
    expect(existsSync(path.join(proj, 'updates', 'v2.json'))).toBe(false);
    expect(await readUpdateSummary(proj)).toBeNull();
    await expect(rollbackVersion(proj)).rejects.toThrow('되돌릴 수 있는 업데이트가 없어요');
  });

  test('도중에 실패하면 프로젝트가 그대로', async () => {
    const { v2, proj } = await setup();
    const before = await snapshot(proj);
    await expect(importVersion(proj, v2, '1.1', { extract: () => Promise.reject(new Error('추출 실패')) })).rejects.toThrow('추출 실패');
    expect(await snapshot(proj)).toEqual(before);
    expect(existsSync(path.join(proj, 'original', 'v2'))).toBe(false);
    expect(existsSync(path.join(proj, 'original', 'v2.tmp'))).toBe(false);
    expect(existsSync(path.join(proj, 'updates', 'v2.json'))).toBe(false);
    expect(existsSync(path.join(proj, 'backups', 'before-v2'))).toBe(false);
    // and a later try still works
    expect((await importVersion(proj, v2, '1.1', { extract: extractFromDir })).to).toBe('v2');
  });

  test('v1 → v2 → v3 로 가져오고 v3 를 되돌리면 v2 상태', async () => {
    const { v2, proj } = await setup();
    await importVersion(proj, v2, '1.1');
    const atV2 = await snapshot(proj);
    const v3 = await makeTempDir();
    await makeMiniGame(v3, { variant: 'v2' });
    const mapFile = path.join(v3, 'data', 'Map001.json');
    const map = JSON.parse(await readFile(mapFile, 'utf8'));
    map.events[1].pages[0].list[7].parameters[0] = 'やったね！！';
    await writeFile(mapFile, JSON.stringify(map));

    const s3 = await importVersion(proj, v3, '1.2');
    expect(s3).toMatchObject({ from: 'v2', to: 'v3', fromLabel: '1.1', toLabel: '1.2', changed: 1 });
    expect(s3.patches[0].result).toBe('moved');
    const units = await loadUnits(proj);
    const store = await TranslationStore.load(proj);
    expect(store.get(units.find((u) => u.source === 'やったね！！')!.id).previous).toEqual({ source: 'やった！！', target: '해냈다!', version: 'v2' });
    expect(store.get(units.find((u) => u.source === 'いいよ')!.id).target).toBe('좋아');

    expect(await rollbackVersion(proj)).toEqual({ restored: 'v2' });
    expect(await snapshot(proj)).toEqual(atV2);
    // v2's own backup still allows going back to v1.
    expect(await rollbackVersion(proj)).toEqual({ restored: 'v1' });
    expect((await openProject(proj)).current).toBe('v1');
  });

  test('옛 형식의 versions 도 가져오기가 된다', async () => {
    const { v1, v2, proj } = await setup();
    const metaFile = path.join(proj, 'project.json');
    const meta = JSON.parse(await read(proj, 'project.json'));
    meta.versions = [{ id: 'v1', importedAt: '2026-01-01T00:00:00.000Z' }];
    await writeFile(metaFile, JSON.stringify(meta, null, 2));
    expect(versionsOf(await openProject(proj))).toEqual([{ id: 'v1', label: 'v1', importedAt: '2026-01-01T00:00:00.000Z', gameDir: meta.gameDir }]);
    const s = await importVersion(proj, v2, '1.1');
    expect(s.fromLabel).toBe('v1');
    const after = await openProject(proj);
    expect(after.versions[0]).toEqual({ id: 'v1', label: 'v1', importedAt: '2026-01-01T00:00:00.000Z', gameDir: meta.gameDir });
    expect(versionsOf(after)[0].gameDir).toBe(path.resolve(v1));
  });

  test('수정이 가리키던 줄이 사라지면 충돌로 남는다', async () => {
    const { v2, proj } = await setup();
    const list = miniMap('MZ').events[1]!.pages[0].list as EventCommand[];
    const patches = await loadPatches(proj);
    patches[0].body = { kind: 'event', file: 'data/Map001.json', listPath: LIST_PATH, baseHash: listHash(list), ops: [{ op: 'delete', at: 6 }] };
    await savePatches(proj, patches);
    const s = await importVersion(proj, v2, '1.1');
    expect(s.patches[0]).toMatchObject({ result: 'conflict' });
    expect(s.patches[0].reason).toContain('수정이 가리키던 줄이 새 버전에 없어요(6번:');
    expect(await loadPatches(proj)).toEqual(patches);
  });
});

test('그림: 지시서의 원본이 바뀌면 changed, 새 그림은 added', async () => {
  const { v2, proj } = await setup();
  const { makePng } = await import('../helpers/png.js');
  const pics = path.join(v2, 'img', 'pictures');
  await mkdir(pics, { recursive: true });
  await writeFile(path.join(pics, 'menu.png'), makePng(4, 4, [255, 0, 0, 255]));
  await writeFile(path.join(pics, 'new.png'), makePng(4, 4, [0, 255, 0, 255]));
  await writeFile(path.join(proj, 'images.json'), JSON.stringify({ defaultFontPath: null, recipes: {
    'img/pictures/menu.png': { file: 'img/pictures/menu.png', baseHash: 'old', regions: [], status: 'done' },
    'img/pictures/gone.png': { file: 'img/pictures/gone.png', baseHash: 'old', regions: [], status: 'done' },
  } }));
  const s = await importVersion(proj, v2, '1.1');
  expect(s.images.changed).toEqual(['img/pictures/menu.png']);
  expect(s.images.removed).toBe(1);
  expect(s.images.added).toBe(2);   // menu.png and new.png were not in v1's files.json
});
