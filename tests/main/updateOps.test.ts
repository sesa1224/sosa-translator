import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { defaultGlossary } from '../../src/core/glossary/store.js';
import { SPEAKER_PRESETS } from '../../src/core/text/speaker.js';
import type { TextUnit, TranslationEntry } from '../../src/core/types.js';
import { GameRunner } from '../../src/main/gameRun.js';
import { ProjectService } from '../../src/main/projectService.js';
import { buildTranslatePrompt, planBatches } from '../../src/main/translate/batches.js';
import { computeStats, filterRows, toRow } from '../../src/shared/rows.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';
import { makeMiniGame } from '../helpers/miniGame.js';

afterEach(cleanupTempDirs);

async function setup() {
  const v1 = await makeTempDir();
  const v2 = await makeTempDir();
  await makeMiniGame(v1);
  await makeMiniGame(v2, { variant: 'v2' });
  const proj = path.join(await makeTempDir(), 'proj');
  const svc = await ProjectService.create(v1, proj, '약초원');
  const id = (s: string) => svc.units().find((u) => u.source === s)!.id;
  await svc.setTranslation(id('やった！'), '해냈다!', 'user');
  await svc.setTranslation(id('あれ？\\N[1]じゃない！\nこんな夜に来るなんて'), '어라? \\N[1] 아니야!\n이런 밤에 오다니', 'user');
  return { v1, v2, proj, svc };
}

test('importVersion 뒤 항목이 새 버전 것이고 reloaded 가 한 번 나간다', async () => {
  const { v2, svc } = await setup();
  let reloaded = 0;
  svc.on('reloaded', () => reloaded++);
  const summary = await svc.importVersion(v2, '1.1');
  expect(summary.to).toBe('v2');
  expect(reloaded).toBe(1);
  expect(svc.units().some((u) => u.source === '星の砂')).toBe(true);
  expect(svc.units().some((u) => u.source === 'むかしむかし')).toBe(false);
  expect(svc.meta.current).toBe('v2');
  expect(svc.versions().map((v) => v.label)).toEqual(['v1', '1.1']);
  expect(await svc.updateSummary()).toEqual(summary);
  const carried = svc.units().find((u) => u.source === 'やった！！')!;
  expect(svc.entry(carried.id)).toMatchObject({ target: '해냈다!', carried: true });

  await svc.rollbackVersion();
  expect(reloaded).toBe(2);
  expect(svc.meta.current).toBe('v1');
  expect(svc.units().some((u) => u.source === 'むかしむかし')).toBe(true);
  expect(await svc.updateSummary()).toBeNull();
  await svc.close();
});

test('작업이 도는 중이면 가져오기와 되돌리기를 거절한다', async () => {
  const { v2, svc } = await setup();
  svc.setBusyCheck(() => true);
  await expect(svc.importVersion(v2, '1.1')).rejects.toThrow('다른 작업이 진행 중입니다');
  await expect(svc.rollbackVersion()).rejects.toThrow('다른 작업이 진행 중입니다');
  expect(svc.meta.current).toBe('v1');
  await svc.close();
});

test('toRow, filterRows, computeStats 가 바뀐 문장과 미리 채운 번역을 센다', async () => {
  const { v2, svc } = await setup();
  await svc.importVersion(v2, '1.1');
  const rows = svc.units().map((u) => toRow(u, svc.entry(u.id)));
  const changed = filterRows(rows, { status: 'changed' });
  expect(changed.map((r) => r.source).sort()).toEqual(['あれ？\\N[1]じゃない！\nこんな夜更けに来るなんて', 'やった！！', '霧の薬草園 ver1.1'].sort());
  const yatta = changed.find((r) => r.source === 'やった！！')!;
  expect(yatta.previous).toEqual({ source: 'やった！', target: '해냈다!' });
  expect(yatta.carried).toBe(true);
  expect(changed.find((r) => r.source.startsWith('あれ'))!.carried).toBeUndefined();
  const stats = computeStats(rows);
  expect(stats.changed).toBe(3);
  expect(stats.carried).toBe(1);
  await svc.close();
});

test('carried 항목을 승인하거나 번역하면 carried 가 없어지고 previous 는 남는다', async () => {
  const { v2, svc } = await setup();
  await svc.importVersion(v2, '1.1');
  const yatta = svc.units().find((u) => u.source === 'やった！！')!.id;
  await svc.setStatus(yatta, 'approved', 'user');
  expect(svc.entry(yatta).carried).toBeUndefined();
  expect(svc.entry(yatta).previous).toEqual({ source: 'やった！', target: '해냈다!', version: 'v1' });
  const line = svc.units().find((u) => u.source.startsWith('あれ'))!.id;
  await svc.setTranslation(line, '어라? \\N[1] 아니야!\n이런 늦은 밤에 오다니', 'user');
  expect(svc.entry(line).previous?.source).toBe('あれ？\\N[1]じゃない！\nこんな夜に来るなんて');
  await svc.close();
});

const BRACKET = SPEAKER_PRESETS.find((p) => p.id === 'bracket')!.pattern;

test('번역 프롬프트에 previous 가 화자 줄 없이 실리고, 없으면 전과 같다', () => {
  const unit: TextUnit = { id: 'a', kind: 'dialogue', source: '【リナ】\n夜更けに来るなんて', needsDecision: false, refs: [{ type: 'value', file: 'data/Map001.json', path: ['a'] }] };
  const other: TextUnit = { id: 'b', kind: 'dialogue', source: '【リナ】\nいいよ', needsDecision: false, refs: [{ type: 'value', file: 'data/Map002.json', path: ['b'] }] };
  const entries: Record<string, TranslationEntry> = {
    a: { target: null, status: 'untranslated', updatedAt: '', previous: { source: '【リナ】\n夜に来るなんて', target: '【리나】\n밤에 오다니', version: 'v1' } },
  };
  const entryOf = (id: string): TranslationEntry => entries[id] ?? { target: null, status: 'untranslated', updatedAt: '' };
  const g = { ...defaultGlossary(), rules: { ...defaultGlossary().rules, speakerPattern: BRACKET } };
  const [withPrev, without] = planBatches([unit, other], entryOf, g);
  const p = buildTranslatePrompt(withPrev, g);
  const item = JSON.parse(p.user).items[0];
  expect(item.previous).toEqual({ source: '夜に来るなんて', target: '밤에 오다니' });
  expect(p.system).toContain('previous 가 있으면 원문이 조금 바뀐 문장이다. 바뀐 부분만 반영하고 나머지는 이전 번역의 표현과 말투를 그대로 둔다');

  const q = buildTranslatePrompt(without, g);
  expect(q.system).not.toContain('원문이 조금 바뀐 문장');
  expect(JSON.parse(q.user).items[0].previous).toBeUndefined();
  const plain = buildTranslatePrompt({ ...without, items: without.items.map(({ previous: _p, ...rest }) => rest) }, g);
  expect(q).toEqual(plain);
});

test('버전이 바뀐 뒤 prepare 하면 옛 세이브는 testplay-saves-<옛 id> 로, 사본은 새 게임 것으로', async () => {
  const v1 = await makeTempDir();
  const v2 = await makeTempDir();
  const proj = await makeTempDir();
  const patchDir = await makeTempDir();
  const put = async (root: string, rel: string, text: string) => {
    const f = path.join(root, ...rel.split('/'));
    await mkdir(path.dirname(f), { recursive: true });
    await writeFile(f, text);
  };
  for (const [rel, text] of Object.entries({ 'Game.exe': 'exe', 'data/Items.json': '[null,"v1"]', 'save/file1.rpgsave': 'SAVE-V1' })) await put(v1, rel, text);
  for (const [rel, text] of Object.entries({ 'Game.exe': 'exe', 'data/Items.json': '[null,"v2"]', 'save/file1.rpgsave': 'SAVE-V2-GAME' })) await put(v2, rel, text);
  const copy = (rel: string) => path.join(proj, 'testplay', ...rel.split('/'));

  await new GameRunner({ projectDir: proj, gameDir: v1, version: 'v1' }).prepare(patchDir);
  await writeFile(copy('save/file1.rpgsave'), 'PLAYED-V1');
  expect(await readFile(path.join(proj, 'testplay', '.version'), 'utf8')).toBe('v1');

  await new GameRunner({ projectDir: proj, gameDir: v2, version: 'v2' }).prepare(patchDir);
  expect(await readFile(path.join(proj, 'testplay-saves-v1', 'file1.rpgsave'), 'utf8')).toBe('PLAYED-V1');
  expect(await readFile(copy('save/file1.rpgsave'), 'utf8')).toBe('SAVE-V2-GAME');
  expect(await readFile(copy('data/Items.json'), 'utf8')).toBe('[null,"v2"]');
  expect(await readFile(path.join(proj, 'testplay', '.version'), 'utf8')).toBe('v2');

  // the same version again keeps the copy's saves
  await writeFile(copy('save/file1.rpgsave'), 'PLAYED-V2');
  await new GameRunner({ projectDir: proj, gameDir: v2, version: 'v2' }).prepare(patchDir);
  expect(await readFile(copy('save/file1.rpgsave'), 'utf8')).toBe('PLAYED-V2');
  expect(existsSync(path.join(proj, 'testplay-saves-v2'))).toBe(false);
});
