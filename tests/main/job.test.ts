import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { SPEAKER_PRESETS } from '../../src/core/text/speaker.js';
import { termId } from '../../src/core/glossary/store.js';
import { ProjectService } from '../../src/main/projectService.js';
import { fixLiteralBreaks, planBatches } from '../../src/main/translate/batches.js';
import { TranslateJob } from '../../src/main/translate/job.js';
import { cleanupTempDirs } from '../helpers/fs.js';
import { idFinder } from './helpers.js';
import { answer, idle, okAll, slow, speakerGame, zero, type FakeCall } from './jobHelpers.js';

let svc: ProjectService;
const idOf = idFinder(() => svc.units());
let total = 0;
let needsDecisionId = '';
let codeId = '';

beforeEach(async () => {
  const { game, proj } = await speakerGame();
  svc = await ProjectService.create(game, proj, '약초원');
  total = svc.units().filter(u => !u.needsDecision).length;
  needsDecisionId = svc.units().find(u => u.needsDecision)!.id;
  codeId = idOf('夜に光る草。\\C[2]貴重\\C[0]だ');
});
afterEach(async () => { await svc.close(); });
afterAll(async () => { await cleanupTempDirs(); });

function mk(call: FakeCall, o: { ids?: string[]; maxItems?: number } = {}): TranslateJob {
  return new TranslateJob({ svc, call: call as any, claude: { command: 'claude' }, model: 'm', cwd: '.', ...o });
}
/** Ids of the job's first batch (planned as if nothing were translated yet). */
const firstBatchIds = () => planBatches(svc.units(), id => svc.entry(id), svc.glossary(), { includeStatuses: ['untranslated', 'translated', 'needs-review', 'approved', 'error', 'declined'] })[0].items.map(i => i.id);
async function withSpeakerGlossary(names: Record<string, string>) {
  const g = svc.glossary();
  g.rules.speakerPattern = SPEAKER_PRESETS.find(p => p.id === 'bracket')!.pattern;
  for (const [source, target] of Object.entries(names)) g.terms.push({ id: termId(source), source, target, category: 'name', status: 'confirmed', candidates: [] });
  await svc.setGlossary(g);
}

test('전부 번역', async () => {
  const job = mk(answer(u => ({ items: u.items.map((x: any) => ({ i: x.i, t: 'KO:' + x.i })) }))); await job.start();
  expect(job.progress).toMatchObject({ state: 'done', done: total, total, declined: 0 });
  expect(svc.entry(idOf('月光草'))).toMatchObject({ status: 'translated' }); expect(svc.entry(needsDecisionId).target).toBeNull();
});
test('화자 줄을 다시 붙인다', async () => {
  await withSpeakerGlossary({ 'アーテル': '아텔' }); await mk(answer(u => ({ items: u.items.map((x: any) => ({ i: x.i, t: '「응?」' })) }))).start();
  expect(svc.entry(idOf('【アーテル】\n「え？」')).target).toBe('【아텔】\n「응?」');
});
test('빼먹은 번호와 없는 번호', async () => {
  await mk(answer(u => ({ items: [{ i: 0, t: '하나' }, { i: 0, t: '중복' }, { i: 99, t: '없는 번호' }] }))).start();
  const first = firstBatchIds(); expect(svc.entry(first[0]).target).toBe('하나'); expect(svc.entry(first[1]).status).toBe('untranslated');
});
test('검사 오류는 한 번 다시 보낸다', async () => {
  const seen: any[] = []; await mk(answer(u => { seen.push(u); return { items: u.items.map((x: any) => ({ i: x.i, t: x.previous ? '밤에 빛나는 풀. \\C[2]귀하다\\C[0]' : '밤에 빛나는 풀' })) }; }), { ids: [codeId] }).start();
  expect(seen).toHaveLength(2); expect(seen[1].items[0].problems[0]).toContain('제어'); expect(svc.entry(codeId).status).toBe('translated');
});
test('거절과 새 용어', async () => {
  const first = firstBatchIds();
  await mk(answer(u => ({ items: u.items.map((x: any) => x.i === 0 ? { i: 0, t: null, declined: '사유' } : { i: x.i, t: 'KO', newTerms: [{ source: 'ギルド', target: '길드' }] }) }))).start();
  expect(svc.entry(first[0])).toMatchObject({ status: 'declined', declinedReason: '사유' });
  expect(svc.glossary().terms.find(t => t.source === 'ギルド')).toMatchObject({ status: 'provisional', target: '길드' });
});
test('한도에 걸리면 멈추고, 이어하면 남은 것만', async () => {
  const remainingBatches = planBatches(svc.units(), id => svc.entry(id), svc.glossary(), { maxItems: 2 }).length - 1;
  let n = 0; const job = mk(async (o: any) => (++n === 2 ? { ok: false, kind: 'limit', message: 'usage limit reached', usage: zero } : okAll(o)), { maxItems: 2 });
  await job.start(); expect(job.progress.state).toBe('paused-limit'); const doneBefore = job.progress.done; expect(doneBefore).toBe(2);
  job.resume(); await idle(job); expect(job.progress.state).toBe('done'); expect(n).toBe(2 + remainingBatches);
});
test('묶음 전체가 거절되면 쪼갠다', async () => {
  const sizes: number[] = []; await mk(async (o: any) => { const u = JSON.parse(o.user); sizes.push(u.items.length);
    return u.items.some((x: any) => x.text.includes('やった')) && u.items.length > 1 ? { ok: false, kind: 'refused', message: '', usage: zero }
      : u.items.length === 1 && u.items[0].text.includes('やった') ? { ok: false, kind: 'refused', message: '', usage: zero } : okAll(o); }).start();
  expect(svc.entry(idOf('やった！'))).toMatchObject({ status: 'declined', declinedReason: '모델이 번역을 거절했습니다' });
  expect(svc.entry(idOf('月光草')).target).not.toBeNull(); expect(Math.min(...sizes)).toBe(1);
});
test('로그인 오류는 실패로 끝낸다', async () => {
  const job = mk(async () => ({ ok: false, kind: 'auth', message: '', usage: zero })); await job.start();
  expect(job.progress).toMatchObject({ state: 'failed', message: '로그인이 필요합니다. 터미널에서 claude 를 실행해 로그인하세요.' });
});
test('멈추기', async () => { const job = mk(slow(okAll)); const p = job.start(); job.stop(); await p; expect(job.progress.state).toBe('stopped'); });

// Extra coverage beyond the plan's assertions.
test('형식이 틀린 답은 쪼개고, 한 항목이면 오류로 센다', async () => {
  const target = idOf('やった！');
  const job = mk(async (o: any) => { const u = JSON.parse(o.user);
    return u.items.some((x: any) => x.text.includes('やった')) ? { ok: false, kind: 'invalid', message: '', usage: zero } : okAll(o); });
  await job.start();
  expect(job.progress).toMatchObject({ state: 'done', errors: 1, done: total });
  expect(svc.entry(target).status).toBe('untranslated');
});
test('실행 실패는 한 번 다시, 또 실패하면 끝낸다', async () => {
  let n = 0; const job = mk(async (o: any) => (++n === 1 ? { ok: false, kind: 'other', message: 'x', usage: zero } : okAll(o)));
  await job.start(); expect(job.progress.state).toBe('done');
  const job2 = mk(async () => ({ ok: false, kind: 'spawn', message: '실행 못 함', usage: zero }), { ids: [idOf('月光草')] });
  await job2.start(); expect(job2.progress).toMatchObject({ state: 'failed', message: '실행 못 함' });
});
test('일시정지 뒤 이어하기, 사용량 합계와 진행 알림', async () => {
  const seen: string[] = [];
  const job = mk(okAll, { maxItems: 2 }); job.on('progress', p => seen.push(p.state));
  const p = job.start(); job.pause(); await p;
  expect(job.progress.state).toBe('paused'); expect(job.progress.done).toBe(2);
  job.resume(); await idle(job);
  expect(job.progress).toMatchObject({ state: 'done', done: total, kind: 'translate' });
  expect(job.progress.usage.input).toBeGreaterThan(0); expect(seen).toContain('paused');
  expect(svc.units().filter(u => !u.needsDecision).every(u => svc.entry(u.id).target !== null)).toBe(true);
});
test('글자 \\n 으로 온 줄바꿈은 실제 줄바꿈으로 고친다', async () => {
  // Seen with the real CLI: the model wrote a line break as backslash + n.
  const id = idOf('あれ？\\N[1]じゃない！\nこんな夜に来るなんて');
  await mk(answer(u => ({ items: u.items.map((x: any) => ({ i: x.i, t: '어라? \\N[1] 아니잖아!\\n이런 밤에 오다니' })) })), { ids: [id] }).start();
  expect(svc.entry(id)).toMatchObject({ target: '어라? \\N[1] 아니잖아!\n이런 밤에 오다니', status: 'translated' });
  expect(fixLiteralBreaks('가\\n나 \\n[1] \\n<x>', 'あ')).toBe('가\n나 \\n[1] \\n<x>');
  expect(fixLiteralBreaks('a\\nb', 'あ\\nい')).toBe('a\\nb');
});
test('전각 문장부호는 반각으로 적힌다 (규칙을 끄면 그대로)', async () => {
  await withSpeakerGlossary({ 'アーテル': '아텔' });
  const call = answer(u => ({ items: u.items.map((x: any) => ({ i: x.i, t: x.speaker ? '「응？」' : '번역！？' + (x.text.match(/\[A-Za-z]+\[\d+\]/g) ?? []).join('') })) }));
  await mk(call).start();
  expect(svc.entry(idOf('【アーテル】\n「え？」')).target).toBe('【아텔】\n「응?」');
  expect(svc.entry(idOf('月光草')).target).toBe('번역!?');
  await svc.setRules({ halfWidth: false }); await mk(call, { ids: [idOf('月光草')] }).start();
  expect(svc.entry(idOf('月光草')).target).toBe('번역！？');
});
test('괄호 규칙이 켜져 있으면 （ ） 도 반각으로 적힌다', async () => {
  const call = answer(u => ({ items: u.items.map((x: any) => ({ i: x.i, t: '（번역！）' })) }));
  await mk(call, { ids: [idOf('月光草')] }).start();
  expect(svc.entry(idOf('月光草')).target).toBe('(번역!)');
  await svc.setRules({ halfWidthBrackets: false }); await mk(call, { ids: [idOf('月光草')] }).start();
  expect(svc.entry(idOf('月光草')).target).toBe('（번역!）');
});

test('보내는 동안 그 묶음의 줄 id 를 진행에 싣고, 끝나면 비운다', async () => {
  const first = firstBatchIds();
  const seen: (string[] | undefined)[] = [];
  const job: TranslateJob = mk(async (o: any) => { seen.push(job.progress.pending); return okAll(o); });
  await job.start();
  expect(seen[0]).toEqual(first);
  expect(seen.every((p) => p !== undefined && p.length > 0)).toBe(true);
  expect(job.progress.pending).toBeUndefined();
});
test('멈추면 번역 중인 줄을 비운다', async () => {
  const job = mk(slow(okAll)); const p = job.start();
  expect(job.progress.pending?.length).toBeGreaterThan(0);
  job.stop(); await p;
  expect(job.progress).toMatchObject({ state: 'stopped' });
  expect(job.progress.pending).toBeUndefined();
});
