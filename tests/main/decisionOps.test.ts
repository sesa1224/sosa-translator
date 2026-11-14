import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { ProjectService } from '../../src/main/projectService.js';
import { callTool } from '../../src/main/toolHandlers.js';
import { buildTranslatePrompt, planBatches } from '../../src/main/translate/batches.js';
import { TranslateJob } from '../../src/main/translate/job.js';
import { computeStats, toRow } from '../../src/shared/rows.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';
import { freshGame, idFinder } from './helpers.js';
import { answer } from './jobHelpers.js';

let svc: ProjectService;
let game: string;
const idOf = idFinder(() => svc.units());
const ARGS = { mode: 'args' as const, from: 1, dropLast: 0 };

beforeEach(async () => {
  const g = await freshGame();
  game = g.game;
  await writeFile(path.join(game, 'index.html'), '<html><head><title>霧の薬草園</title></head></html>');
  svc = await ProjectService.create(game, g.proj, '약초원');
});
afterEach(async () => { await svc.close(); });
afterAll(cleanupTempDirs);

const plan = () => planBatches(svc.units(), (id) => svc.entry(id), svc.glossary(), { decisions: svc.decisions() });
const planned = () => plan().flatMap((b) => b.items);
const rowOf = (id: string) => toRow(svc.unit(id)!, svc.entry(id));
const stats = () => computeStats(svc.units().map((u) => toRow(u, svc.entry(u.id))));

test('확정한 결정만 번역 대상에 들어가고 keep 이 실린다', async () => {
  const id = idOf('ShowRecord 記録');
  await svc.addSuggestions({ 'mv:ShowRecord': { translate: true, keep: ARGS, status: 'suggested', by: 'claude' } });
  expect(planned().some((i) => i.id === id)).toBe(false);
  await svc.setDecision('mv:ShowRecord', { translate: true, keep: ARGS }, 'user');
  const item = planned().find((i) => i.id === id)!;
  expect(item.keep).toEqual(['ShowRecord ', '']);
  const batch = plan().find((b) => b.items.some((i) => i.id === id))!;
  const p = buildTranslatePrompt(batch, svc.glossary());
  expect(JSON.parse(p.user).items.find((i: any) => i.text === 'ShowRecord 記録').keep).toEqual(['ShowRecord ', '']);
  expect(p.system).toContain('keep 이 있으면 그 글들은 한 글자도 바꾸지 않고 같은 순서로 남긴다');
});

test('뼈대가 깨진 답은 한 번 다시 보내고, 또 깨지면 error', async () => {
  const id = idOf('ShowRecord 記録');
  await svc.setDecision('mv:ShowRecord', { translate: true, keep: ARGS }, 'user');
  const seen: any[] = [];
  const job = new TranslateJob({ svc, call: answer((u) => { seen.push(u); return { items: u.items.map((x: any) => ({ i: x.i, t: '기록 보기' })) }; }) as any, claude: { command: 'claude' }, model: 'm', cwd: '.', ids: [id] });
  await job.start();
  expect(seen).toHaveLength(2);
  expect(seen[1].items[0].problems[0]).toContain('그대로 둬야 하는 부분이 바뀌었습니다');
  expect(svc.entry(id)).toMatchObject({ target: '기록 보기', status: 'error' });
  const ok = new TranslateJob({ svc, call: answer((u) => ({ items: u.items.map((x: any) => ({ i: x.i, t: 'ShowRecord 기록' })) })) as any, claude: { command: 'claude' }, model: 'm', cwd: '.', ids: [id] });
  await ok.start();
  expect(svc.entry(id)).toMatchObject({ target: 'ShowRecord 기록', status: 'translated' });
});

test('게임 제목: approved 로 쓰이고 빌드에 index.html 이 들어간다', async () => {
  await svc.setGameTitle('안개 약초원');
  expect(svc.entry(idOf('霧の薬草園'))).toMatchObject({ target: '안개 약초원', status: 'approved' });
  const r = await svc.build();
  const zip = unzipSync(await readFile(r.zipPath));
  expect(strFromU8(zip['index.html'])).toContain('<title>안개 약초원</title>');
});

test('Row.decision 다섯 값과 Stats.undecided', async () => {
  const id = idOf('ShowRecord 記録');
  const before = stats().undecided;
  expect(rowOf(id).decision).toBe('none');
  expect(rowOf(idOf('月光草')).decision).toBeNull();
  await svc.addSuggestions({ 'mv:ShowRecord': { translate: true, keep: ARGS, status: 'suggested', by: 'claude' } });
  expect(rowOf(id).decision).toBe('suggested-translate');
  await svc.addSuggestions({ 'mv:ShowRecord': { translate: false, keep: ARGS, status: 'suggested', by: 'claude' } });
  expect(rowOf(id).decision).toBe('suggested-skip');
  await svc.confirmSuggestions();
  expect(rowOf(id).decision).toBe('skip');
  expect(stats().undecided).toBe(before - 1);
  await svc.setDecision('mv:ShowRecord', { translate: true, keep: ARGS }, 'user');
  expect(rowOf(id).decision).toBe('translate');
  await svc.clearDecision('mv:ShowRecord');
  expect(rowOf(id).decision).toBe('none');
  await expect(svc.setDecision('mv:NoSuch', { translate: true, keep: ARGS }, 'user')).rejects.toThrow('없는 판단 키');
});

test('결정이 바뀌면 그 키의 항목에 변경 알림과 decisions-changed', async () => {
  const events: string[][] = [];
  let decided = 0;
  svc.on('changed', (e) => events.push(e.ids));
  svc.on('decisions-changed', () => decided++);
  await svc.setDecision('mv:ShowRecord', { translate: false, keep: { mode: 'whole' } }, 'user');
  expect(events).toEqual([[idOf('ShowRecord 記録')]]);
  expect(decided).toBe(1);
});

test('내보내고 채워서 가져오기: external, 충돌은 덮어쓰지 않음', async () => {
  const dir = await makeTempDir();
  const out = path.join(dir, 'pkg.json');
  const a = idOf('月光草');
  const b = idOf('リナ');
  await svc.setTranslation(b, '리나', 'user');
  await svc.exportPackage([a, b], out);
  const pkg = JSON.parse(await readFile(out, 'utf8'));
  expect(pkg.items.map((i: any) => i.id)).toEqual(expect.arrayContaining([a, b]));
  const reply = path.join(dir, 'reply.json');
  await writeFile(reply, JSON.stringify(pkg.items.map((i: any) => ({ id: i.id, target: i.id === a ? '월광초' : '리나짱' }))));
  const p = await svc.importPackage(reply);
  expect(p.ok.map((o) => o.id)).toEqual([a]);
  expect(p.conflicts).toEqual([{ id: b, current: '리나', incoming: '리나짱' }]);
  expect(await svc.applyImport(p, false)).toEqual({ written: 1 });
  expect(svc.entry(a)).toMatchObject({ target: '월광초', external: true });
  expect(rowOf(a).external).toBe(true);
  expect(svc.entry(b).target).toBe('리나');
  expect(stats().external).toBe(1);
  await svc.applyImport(p, true);
  expect(svc.entry(b)).toMatchObject({ target: '리나짱', external: true });
});

test('채팅 도구: set_decision 뒤 list_decisions 가 보여준다, 모르는 키는 실패', async () => {
  const set = await callTool(svc, 'set_decision', { key: 'mv:ShowRecord', translate: true, mode: 'args', reason: '메뉴 글자' });
  expect(set.ok).toBe(true);
  const list = await callTool(svc, 'list_decisions', { query: 'ShowRecord' });
  expect((list as any).data.groups[0]).toMatchObject({ key: 'mv:ShowRecord', label: 'ShowRecord', count: 1, samples: ['ShowRecord 記録'],
    decision: { translate: true, keep: { mode: 'args', from: 1, dropLast: 0 }, status: 'confirmed', by: 'claude', reason: '메뉴 글자' } });
  expect(await callTool(svc, 'set_decision', { key: 'mv:Nope', translate: true })).toMatchObject({ ok: false });
});

test('다시 열어도 결정이 남고, 결정 키 없는 예전 units.json 은 다시 추출한다', async () => {
  await svc.setDecision('mv:ShowRecord', { translate: true, keep: ARGS }, 'user');
  const dir = svc.projectDir;
  const unitsFile = path.join(dir, 'units.json');
  const old = JSON.parse(await readFile(unitsFile, 'utf8')).map(({ decisionKey: _k, ...u }: any) => u);
  await writeFile(unitsFile, JSON.stringify(old));
  await svc.close();
  svc = await ProjectService.open(dir);
  expect(svc.unit(idOf('ShowRecord 記録'))!.decisionKey).toBe('mv:ShowRecord');
  expect(rowOf(idOf('ShowRecord 記録')).decision).toBe('translate');
});
