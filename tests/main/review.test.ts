import { afterAll, beforeAll, expect, test } from 'vitest';
import { finalPrompt } from '../../src/core/glossary/prompts.js';
import type { TranslationEntry } from '../../src/core/types.js';
import { ProjectService } from '../../src/main/projectService.js';
import { buildReviewPrompt, estimateTokens, isReviewAnswer, planReview, REVIEW_SCHEMA, ReviewJob } from '../../src/main/translate/review.js';
import { cleanupTempDirs } from '../helpers/fs.js';
import { freshGame, idFinder } from './helpers.js';
import { answer, idle, zero, type FakeCall } from './jobHelpers.js';

let svc: ProjectService;
const idOf = idFinder(() => svc.units());
const ko: Record<string, string> = { 'リナ': '리나', '薬草園の見習い': '약초원의 견습생', '月光草': '월광초', 'いいよ': '좋아', 'また今度': '다음에', 'やった！': '해냈다!' };
let translatedCount = 0;
let a = '';
let b = '';

beforeAll(async () => {
  const { game, proj } = await freshGame();
  svc = await ProjectService.create(game, proj, '약초원');
  for (const [s, t] of Object.entries(ko)) await svc.setTranslation(idOf(s), t, 'user');
  await svc.setStatus(idOf('いいよ'), 'approved', 'user');
  translatedCount = Object.keys(ko).length;
});
afterAll(async () => { await svc.close(); await cleanupTempDirs(); });

const units = () => svc.units();
const entryOf = (id: string) => svc.entry(id);
const g = () => svc.glossary();
const entryOfReviewed = (id: string): TranslationEntry => { const e = svc.entry(id); return { ...e, reviewedAt: e.updatedAt }; };
const mkReview = (call: FakeCall, scope: { scope: 'all' | 'unreviewed' | 'file'; file?: string } = { scope: 'all' }) =>
  new ReviewJob({ svc, call: call as any, claude: { command: 'claude' }, model: 'review-model', cwd: '.', scope });
const firstBatchIds = () => planReview(units(), entryOf, g(), { scope: 'all' }).batches[0].items.map(i => i.id);

test('범위와 추정', () => {
  const all = planReview(units(), entryOf, g(), { scope: 'all' }); expect(all.items).toBe(translatedCount); expect(all.estimatedInputTokens).toBeGreaterThan(0);
  expect(planReview(units(), entryOf, g(), { scope: 'file', file: 'data/Items.json' }).items).toBe(1);
  expect(planReview(units(), entryOfReviewed, g(), { scope: 'unreviewed' }).items).toBe(0);
});
test('문제 있는 것만 올라온다', async () => {
  [a, b] = firstBatchIds();
  await mkReview(answer(u => ({ problems: [{ i: 0, problem: '어미가 인물과 안 맞음', suggestion: '고친 문장' }] }))).start();
  expect(svc.entry(a)).toMatchObject({ status: 'needs-review', review: { problem: '어미가 인물과 안 맞음', suggestion: '고친 문장' } });
  expect(svc.entry(b).review).toBeUndefined(); expect(svc.entry(b).reviewedAt).toBeTruthy();
  expect(svc.entry(b).status).toBe('translated');   // nothing wrong: it does not join the to-look list
});
test('받기와 거절', async () => {
  await svc.acceptReview(a); expect(svc.entry(a)).toMatchObject({ target: '고친 문장', status: 'translated' }); expect(svc.entry(a).review).toBeUndefined();
  await svc.setReview(b, { problem: 'p', suggestion: 's', model: 'm' }, 'review'); await svc.rejectReview(b); expect(svc.entry(b).target).not.toBe('s'); expect(svc.entry(b).review).toBeUndefined();
  expect(svc.entry(b).status).toBe('translated');
});
test('프롬프트', () => {
  const batch = planReview(units(), entryOf, g(), { scope: 'all' }).batches[0];
  const p = buildReviewPrompt(batch, g()); expect(p.system).toContain(g().styleGuide); expect(JSON.parse(p.user).items[0]).toMatchObject({ i: 0, source: expect.any(String), target: expect.any(String) });
});

// Extra coverage beyond the plan's assertions.
test('추정 토큰, 지난 검수 이후, 형식', async () => {
  expect(estimateTokens(10)).toBe(12);
  const all = planReview(units(), entryOf, g(), { scope: 'all' });
  const chars = all.batches.reduce((n, bt) => n + bt.items.reduce((m, i) => m + i.source.length + i.target.length, 0) + finalPrompt('review', g()).length, 0);
  expect(all.estimatedInputTokens).toBe(estimateTokens(chars));
  // a was changed by accepting the suggestion after the review: still counts as reviewed (reviewedAt = updatedAt).
  expect(planReview(units(), entryOf, g(), { scope: 'unreviewed' }).items).toBe(0);
  await new Promise(r => setTimeout(r, 5));
  await svc.setTranslation(idOf('リナ'), '리나!', 'user');
  expect(planReview(units(), entryOf, g(), { scope: 'unreviewed' }).batches.flatMap(bt => bt.items.map(i => i.id))).toEqual([idOf('リナ')]);
  expect(JSON.stringify(REVIEW_SCHEMA)).toContain('suggestion');
  expect(buildReviewPrompt(all.batches[0], g()).system).toContain('취향');
});
test('검수 실패는 그 묶음을 건너뛴다', async () => {
  const batches = planReview(units(), entryOf, g(), { scope: 'all' }).batches.length;
  const job = mkReview(async () => ({ ok: false, kind: 'invalid', message: '', usage: zero }));
  await job.start(); expect(job.progress).toMatchObject({ kind: 'review', state: 'done', errors: batches });
  const job2 = mkReview(async () => ({ ok: false, kind: 'limit', message: 'usage limit reached', usage: zero }));
  await job2.start(); expect(job2.progress.state).toBe('paused-limit'); job2.stop(); await idle(job2); expect(job2.progress.state).toBe('stopped');
  expect(svc.entry(b).review).toBeUndefined();
});
test('승인된 항목에 의견이 붙으면 검토 필요로 돌아간다', async () => {
  const id = idOf('いいよ');
  await svc.rejectReview(id); await svc.setStatus(id, 'approved', 'user');
  expect(svc.entry(id).status).toBe('approved');
  await svc.setReview(id, { problem: 'p', suggestion: 's', model: 'm' }, 'review');
  expect(svc.entry(id)).toMatchObject({ status: 'needs-review', target: '좋아' });
  expect((await svc.undo('review'))).toEqual([id]); expect(svc.entry(id).status).toBe('approved');
});
test('처리한 검수 의견은 남고, 반대쪽으로 바꿀 수 있다', async () => {
  const id = idOf('いいよ');
  await svc.setReview(id, { problem: '말투', suggestion: '좋아요', model: 'm' }, 'review');
  await svc.acceptReview(id);
  expect(svc.entry(id)).toMatchObject({ target: '좋아요', status: 'translated', pastReview: { problem: '말투', before: '좋아', suggestion: '좋아요', taken: 'suggestion' } });
  expect(svc.entry(id).review).toBeUndefined();
  await svc.switchPastReview(id);
  expect(svc.entry(id)).toMatchObject({ target: '좋아', status: 'translated', pastReview: { before: '좋아', suggestion: '좋아요', taken: 'before' } });
  await svc.switchPastReview(id); expect(svc.entry(id)).toMatchObject({ target: '좋아요', pastReview: { taken: 'suggestion' } });
  expect(await svc.undo('user')).toEqual([id]); expect(svc.entry(id).target).toBe('좋아');
  // An edit by hand keeps the record of the remark.
  await svc.setTranslation(id, '좋지', 'user'); expect(svc.entry(id).pastReview).toMatchObject({ before: '좋아', suggestion: '좋아요' });
  // Passing a remark over is recorded too, with the translation it was about.
  await svc.setReview(id, { problem: '다른 지적', suggestion: '그래', model: 'm' }, 'review'); await svc.rejectReview(id);
  expect(svc.entry(id)).toMatchObject({ target: '좋지', status: 'translated', pastReview: { problem: '다른 지적', before: '좋지', suggestion: '그래', taken: 'before' } });
  expect(svc.entry(id).review).toBeUndefined();
  await svc.switchPastReview(id); expect(svc.entry(id).target).toBe('그래');
  const untouched = units().find((u) => svc.entry(u.id).target !== null && !svc.entry(u.id).pastReview)!.id;
  await expect(svc.switchPastReview(untouched)).rejects.toThrow('지난 검수 의견이 없습니다');
});
test('받아도 달라지는 것이 없는 의견은 올라오지 않는다', async () => {
  const ids = firstBatchIds();
  const before = ids.map((id) => svc.entry(id).target);
  await mkReview(answer(u => ({ problems: [{ i: 0, problem: '괄호', suggestion: u.items[0].target }] }))).start();
  expect(svc.entry(ids[0]).review).toBeUndefined(); expect(svc.entry(ids[0]).status).not.toBe('needs-review');
  expect(ids.map((id) => svc.entry(id).target)).toEqual(before);
});
test('검수 의견을 한꺼번에 받고 넘긴다', async () => {
  const open = units().filter((u) => svc.entry(u.id).target !== null && !svc.entry(u.id).review).slice(0, 4).map((u) => u.id);
  const [x, y, z, plain] = open;
  for (const id of [x, y, z]) await svc.setReview(id, { problem: '전각 괄호', suggestion: `고침-${id}`, model: 'm' }, 'review');
  const zBefore = svc.entry(z).target;
  // Ids without an open remark are passed by, not an error: the list on screen may be a moment old.
  expect(await svc.acceptReviews([x, y, plain])).toBe(2);
  expect(svc.entry(x)).toMatchObject({ target: `고침-${x}`, pastReview: { taken: 'suggestion', problem: '전각 괄호' } });
  expect(svc.entry(y).review).toBeUndefined(); expect(svc.entry(z).review).toBeDefined();
  expect(await svc.rejectReviews([z, plain])).toBe(1);
  expect(svc.entry(z)).toMatchObject({ target: zBefore, status: 'translated', pastReview: { taken: 'before', suggestion: `고침-${z}` } });
  expect(await svc.rejectReviews([plain])).toBe(0);
});
test('검수 의견에는 종류가 붙고, 모르는 종류는 종류 없이 남는다', async () => {
  const item = (REVIEW_SCHEMA.properties.problems.items as any);
  expect(item.required).toContain('kind');
  expect(item.properties.kind.enum).toEqual(['meaning', 'tone', 'term', 'sound', 'form', 'style']);
  expect(item.properties.kind.description).toContain('의성어');
  // The model may leave it out or make one up: the remark still counts.
  expect(isReviewAnswer({ problems: [{ i: 0, problem: 'p', suggestion: 's' }] })).toBe(true);
  expect(isReviewAnswer({ problems: [{ i: 0, problem: 'p', suggestion: 's', kind: 'what' }] })).toBe(true);
  const ids = firstBatchIds();
  for (const id of ids) await svc.rejectReview(id);
  await mkReview(answer(() => ({ problems: [
    { i: 0, problem: '어미', suggestion: '종류-말투', kind: 'tone' },
    { i: 1, problem: '모름', suggestion: '종류-모름', kind: 'what' },
  ] }))).start();
  expect(svc.entry(ids[0]).review).toMatchObject({ problem: '어미', kind: 'tone' });
  expect(svc.entry(ids[1]).review).toBeDefined(); expect('kind' in svc.entry(ids[1]).review!).toBe(false);
  await svc.rejectReview(ids[0]); expect(svc.entry(ids[0]).pastReview).toMatchObject({ kind: 'tone', taken: 'before' });
});
