import { afterAll, beforeAll, expect, test } from 'vitest';
import { finalPrompt } from '../../src/core/glossary/prompts.js';
import type { TranslationEntry } from '../../src/core/types.js';
import { ProjectService } from '../../src/main/projectService.js';
import { buildReviewPrompt, estimateTokens, planReview, REVIEW_SCHEMA, ReviewJob } from '../../src/main/translate/review.js';
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
