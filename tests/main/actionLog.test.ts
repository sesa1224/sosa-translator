import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { termId } from '../../src/core/glossary/store.js';
import { ProjectService } from '../../src/main/projectService.js';
import { TranslateJob } from '../../src/main/translate/job.js';
import { ReviewJob } from '../../src/main/translate/review.js';
import { cleanupTempDirs } from '../helpers/fs.js';
import { freshGame, idFinder } from './helpers.js';
import { answer, okAll, type FakeCall } from './jobHelpers.js';

let proj: string, svc: ProjectService;
const idOf = idFinder(() => svc.units());

beforeEach(async () => {
  const g = await freshGame();
  proj = g.proj;
  svc = await ProjectService.create(g.game, proj, '약초원');
});
afterEach(async () => { await svc.close(); });
afterAll(async () => { await cleanupTempDirs(); });

const opts = (call: FakeCall) => ({ svc, call: call as any, claude: { command: 'claude' }, model: 'm', cwd: '.' });

test('한 번의 고침은 기록 하나, 목록에는 바뀐 내용이 실리지 않는다', async () => {
  const id = idOf('月光草');
  await svc.setTranslation(id, '월광초', 'user');
  await svc.setStatus(id, 'approved', 'user');
  await svc.clearTranslation(id, 'user');
  const list = svc.actions();
  expect(list.map((a) => a.label)).toEqual(['번역 지움', '상태 바꿈', '번역 고침']);
  expect(list[0]).toMatchObject({ origin: 'user', count: 1 });
  expect(list[0].undoneAt).toBeUndefined();
  for (const a of list) expect(a).not.toHaveProperty('changes');
  expect(existsSync(path.join(proj, 'history.json'))).toBe(true);
});

test('번역 작업 하나는 기록 하나, 바뀐 것이 없는 쓰기는 남기지 않는다', async () => {
  await new TranslateJob(opts(okAll)).start();
  const translated = svc.units().filter((u) => svc.entry(u.id).target !== null).length;
  const list = svc.actions();
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ origin: 'batch', count: translated, label: `전체 번역 ${translated.toLocaleString('en-US')}개` });
  await svc.markReviewed([idOf('月光草')], 'review');
  expect(svc.actions()).toHaveLength(1);
});

test('검수 작업은 의견 수로 기록 하나, 한꺼번에 받기도 하나', async () => {
  await new TranslateJob(opts(okAll)).start();
  const call = answer((u) => ({ problems: u.items.slice(0, 2).map((x: any) => ({ i: x.i, problem: '어색함', suggestion: `고침${x.i}`, kind: 'style' })) }));
  await new ReviewJob(opts(call)).start();
  const remarks = svc.units().filter((u) => svc.entry(u.id).review).map((u) => u.id);
  expect(remarks.length).toBeGreaterThan(1);
  expect(svc.actions()[0]).toMatchObject({ origin: 'review', label: `검수: 의견 ${remarks.length}개`, count: remarks.length });
  await svc.acceptReviews(remarks);
  expect(svc.actions()[0]).toMatchObject({ label: `검수 의견 ${remarks.length}개 받음`, count: remarks.length });
});

test('이 행동만 취소: 그 뒤에 안 바뀐 줄만 되돌리고, 두 번은 못 한다', async () => {
  const a = idOf('月光草');
  const b = idOf('リナ');
  await svc.setTranslation(a, '월광초', 'user');
  await svc.setTranslation(b, '리나', 'user');
  await svc.beginAction('batch', (n) => `전체 번역 ${n}개`);
  await svc.setTranslation(a, '달빛풀', 'batch');
  await svc.setTranslation(b, '린', 'batch');
  await svc.endAction('batch');
  await svc.setTranslation(b, '리나짱', 'user');
  const job = svc.actions()[1];
  expect(job).toMatchObject({ label: '전체 번역 2개', count: 2 });
  expect(await svc.cancelAction(job.id)).toEqual({ restored: 1, skipped: 1 });
  expect(svc.entry(a).target).toBe('월광초');
  expect(svc.entry(b).target).toBe('리나짱');
  expect(svc.actions()[1].undoneAt).toEqual(expect.any(String));
  // The cancel is not an action of its own.
  expect(svc.actions()).toHaveLength(4);
  await expect(svc.cancelAction(job.id)).rejects.toThrow('이미 취소한 행동입니다');
  expect(JSON.parse(readFileSync(path.join(proj, 'translations.json'), 'utf8'))[a].target).toBe('월광초');
});

test('이 시점으로 되돌리기: 그 뒤의 행동을 새것부터 취소하고 그 행동은 남긴다', async () => {
  const a = idOf('月光草');
  await svc.setTranslation(a, '하나', 'user');
  await svc.setTranslation(a, '둘', 'user');
  await svc.setTranslation(a, '셋', 'user');
  await svc.setTranslation(idOf('リナ'), '리나', 'user');
  const [, , second, first] = svc.actions();
  await svc.cancelAction(svc.actions()[0].id);   // already cancelled ones are passed by
  expect(await svc.rollbackTo(second.id)).toEqual({ restored: 1, skipped: 0 });
  expect(svc.entry(a).target).toBe('둘');
  expect(svc.entry(idOf('リナ')).target).toBeNull();
  expect(svc.actions().find((x) => x.id === second.id)!.undoneAt).toBeUndefined();
  expect(svc.actions().find((x) => x.id === first.id)!.undoneAt).toBeUndefined();
});

test('기록은 최근 200개만, 프로젝트를 다시 열어도 남는다', async () => {
  const a = idOf('月光草');
  for (let i = 0; i < 205; i++) await svc.setTranslation(a, `번역${i}`, 'user');
  expect(svc.actions()).toHaveLength(200);
  await svc.close();
  svc = await ProjectService.open(proj);
  const list = svc.actions();
  expect(list).toHaveLength(200);
  expect(list[0].label).toBe('번역 고침');
  expect(await svc.cancelAction(list[0].id)).toEqual({ restored: 1, skipped: 0 });
  expect(svc.entry(a).target).toBe('번역203');
});

test('목록의 줄 미리 보기와 상세: 위치 이름, 전후, offset/limit, 없는 행동', async () => {
  const a = idOf('月光草');
  const b = idOf('リナ');
  await svc.beginAction('chat', (n) => `채팅에서 바꿈 ${n}개`);
  await svc.setTranslation(a, '월광초', 'chat');
  await svc.setTranslation(b, '리나', 'chat');
  await svc.endAction('chat');
  const [act] = svc.actions();
  expect(act.preview).toEqual({ source: '月光草', target: '월광초', more: 1 });
  const d = svc.actionDetail(act.id);
  expect(d).toMatchObject({ id: act.id, total: 2, offset: 0 });
  expect(d.lines[0]).toMatchObject({ unitId: a, exists: true, source: '月光草', before: { target: null, status: 'untranslated' }, after: { target: '월광초' } });
  expect(d.lines[0].location).not.toBe('');
  expect(svc.actionDetail(act.id, 1, 100).lines.map((l) => l.unitId)).toEqual([b]);
  expect(() => svc.actionDetail('nope')).toThrow('없는 행동입니다');
});

test('preview 없이 저장된 옛 history.json 도 읽히고 미리 보기가 붙는다, 지금 없는 문장은 표시', async () => {
  const a = idOf('月光草');
  await svc.close();
  const at = '2026-11-15T00:00:00.000Z';
  const old = [
    { id: 'old1', at, origin: 'user', label: '번역 고침', changes: [{ unitId: a, before: { target: null, status: 'untranslated', updatedAt: at }, after: { target: '월광초', status: 'translated', updatedAt: at } }] },
    { id: 'old2', at, origin: 'user', label: '번역 고침', changes: [{ unitId: 'gone', before: { target: null, status: 'untranslated', updatedAt: at }, after: { target: '없음', status: 'translated', updatedAt: at } }] },
  ];
  writeFileSync(path.join(proj, 'history.json'), JSON.stringify(old));
  svc = await ProjectService.open(proj);
  const list = svc.actions();
  expect(list.map((x) => x.id)).toEqual(['old2', 'old1']);
  expect(list[1].preview).toEqual({ source: '月光草', target: '월광초', more: 0 });
  expect(list[0].preview).toMatchObject({ source: null, target: '없음' });
  expect(svc.actionDetail('old2').lines[0]).toMatchObject({ exists: false, source: null, location: '' });
});

test('용어 바꾸기 기록은 옛 번역과 새 번역을 적는다', async () => {
  const b = idOf('リナ');
  await svc.upsertTerm({ source: 'リナ', target: '리나', category: 'name', status: 'provisional', candidates: [{ target: '리나', reason: '' }, { target: '린', reason: '' }] });
  await svc.setTranslation(b, '리나', 'user');
  await svc.chooseCandidate(termId('リナ'), '린');
  expect(svc.actions()[0].label).toBe('용어 바꾸기: 리나 → 린 (1곳)');
});
