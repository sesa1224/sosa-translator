import { act, cleanup, screen, within } from '@testing-library/react';
import { type UserEvent } from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { useApp } from '../../src/renderer/state';
import type { ChatUsage, Glossary, Row } from '../../src/shared/api';
import { baseRows, fakeApi, itemId, openFakeWith, scopes, stats, type FakeApi } from './fakeApi';

let api: FakeApi;
let user: UserEvent;

const confirmed: Partial<Glossary> = { confirmedAt: '2026-11-13T03:00:00.000Z' };
const u = (input: number, output: number): ChatUsage => ({ input, output, cacheRead: 0, cacheCreate: 0 });
const reviewedId = 'r-reviewed';
const extraRows: Row[] = [
  { id: 'r-extra', kind: 'dialogue', speaker: 'リナ', source: 'またね', target: null, status: 'untranslated', needsDecision: false, file: 'data/Map001.json', location: '맵1 · 이벤트1', refCount: 1, usesProvisional: false },
  { id: reviewedId, kind: 'dialogue', source: 'ありがとう', target: '고마워요', status: 'needs-review', needsDecision: false, file: 'data/Map001.json', location: '맵1 · 이벤트2', refCount: 1, usesProvisional: false,
    review: { problem: '어미가 인물과 안 맞음', suggestion: '고마워', model: 'claude-fable-5-2' } },
  { id: 'r-past', kind: 'dialogue', source: 'どうも', target: '고마워', status: 'translated', needsDecision: false, file: 'data/Map001.json', location: '맵1 · 이벤트4', refCount: 1, usesProvisional: false,
    pastReview: { problem: '어미가 딱딱함', suggestion: '고마워', model: 'claude-fable-5-2', before: '고맙습니다', taken: 'suggestion', at: '2026-11-16T01:00:00.000Z' } },
  { id: 'r-declined', kind: 'dialogue', source: 'やめて', target: null, status: 'declined', declinedReason: '모델이 번역을 거절했습니다', needsDecision: false, file: 'data/Map001.json', location: '맵1 · 이벤트3', refCount: 1, usesProvisional: false },
];
const itemRow = baseRows.find(r => r.id === itemId)!;

async function openFake(o: { glossary?: Partial<Glossary>; select?: string } = {}) {
  cleanup();
  api = fakeApi({ glossary: o.glossary, rows: [...baseRows, ...extraRows] });
  api.reviewPlanValue = { items: 120, estimatedInputTokens: 31000, model: 'claude-fable-5-2' };
  user = await openFakeWith(api, { select: o.select });
}
async function openSettings() {
  await openFake();
  act(() => { useApp.setView('settings'); });
  await screen.findByRole('heading', { name: '설정' });
}

test('확정 전에는 번역을 맡길 수 없다', async () => {
  await openFake({ glossary: { confirmedAt: null } }); expect(screen.getByRole('button', { name: /번역 맡기기/ })).toBeDisabled(); expect(screen.getByText('용어집을 먼저 확정하세요')).toBeVisible();
});
test('진행 막대와 한도 멈춤', async () => {
  await openFake({ glossary: confirmed }); await user.click(screen.getByRole('button', { name: '새 문장 7개 번역 맡기기' })); expect(api.calls).toContainEqual(['job.translate', undefined]);
  api.emit('job:progress', { kind: 'translate', state: 'running', done: 80, total: 200, label: '맵4 (2/5)', usage: u(12000, 3000), declined: 1, errors: 0 });
  expect(await screen.findByText('번역 중 · 맵4 (2/5)')).toBeVisible(); expect(screen.getByText('80 / 200')).toBeVisible(); expect(screen.getByText('거절 1')).toBeVisible();
  api.emit('job:progress', { kind: 'translate', state: 'paused-limit', done: 80, total: 200, label: '', usage: u(0, 0), declined: 1, errors: 0, message: 'usage limit reached' });
  expect(await screen.findByText('사용량 한도 때문에 멈췄어요')).toBeVisible(); await user.click(screen.getByRole('button', { name: '이어하기' })); expect(api.calls.at(-1)).toEqual(['job.resume']);
});
test('검수 범위와 추정', async () => {
  await openFake({ glossary: confirmed }); await user.click(screen.getByRole('button', { name: '번역 전체 검수' })); await user.click(screen.getByLabelText('지난 검수 이후 바뀐 것만'));
  expect(await screen.findByText('항목 120개 · 예상 입력 약 31,000 토큰 · 모델 Claude Fable 5.2')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '검수 시작' })); expect(api.calls.at(-1)).toEqual(['job.review', { scope: 'unreviewed' }]);
});
test('검수 의견 받기', async () => {
  await openFake({ select: reviewedId }); expect(screen.getByText('어미가 인물과 안 맞음')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '고친 안 받기' })); expect(api.calls.at(-1)).toEqual(['unit.acceptReview', reviewedId]);
});
test('지난 검수 의견을 보고 되돌린다', async () => {
  await openFake({ select: 'r-past' });
  const box = screen.getByRole('region', { name: '지난 검수 의견' });
  expect(within(box).getByText('어미가 딱딱함')).toBeVisible(); expect(within(box).getByText('고친 안 받음', { exact: false })).toBeVisible();
  expect(within(box).getByText('고맙습니다')).toBeVisible();
  await user.click(within(box).getByRole('button', { name: '고치기 전으로 되돌리기' })); expect(api.calls.at(-1)).toEqual(['unit.switchPastReview', 'r-past']);
});
test('고치는 중에 밖에서 바뀌면 덮지 않는다', async () => {
  await openFake({ select: itemId }); await user.type(screen.getByLabelText('번역'), ' 추가');
  api.emit('project:changed', { rows: [{ ...itemRow, target: '채팅이 바꾼 값' }], stats, scopes, origin: 'chat' });
  expect((screen.getByLabelText('번역') as HTMLTextAreaElement).value).toContain('추가'); expect(screen.getByText('다른 곳에서 이 줄이 바뀌었어요')).toBeVisible();
});
test('단계별 모델 설정', async () => {
  await openSettings(); await user.selectOptions(screen.getByLabelText('전체 번역'), 'claude-sonnet-5-5'); expect((api.calls.at(-1) as any)[1].stageModels.translate).toBe('claude-sonnet-5-5');
});

// Extra coverage beyond the plan's assertions.
test('끝난 작업 알림, 결정 안 한 용어, 닫기', async () => {
  await openFake({ glossary: { ...confirmed, terms: [{ id: 'o', source: '乙女', target: '오토메', category: 'name', status: 'provisional', candidates: [] }] } });
  api.emit('job:progress', { kind: 'translate', state: 'done', done: 10, total: 10, label: '', usage: u(100, 50), declined: 2, errors: 1 });
  expect(await screen.findByText('끝났어요 · 7개 번역 · 거절 2 · 오류 1')).toBeVisible();
  await user.click(screen.getByRole('button', { name: '결정 안 한 용어 1개' }));
  expect(useApp.get().view).toBe('glossary');
  await user.click(screen.getByRole('button', { name: '작업 알림 닫기' }));
  expect(screen.queryByText(/끝났어요/)).toBeNull();
  api.emit('job:progress', { kind: 'review', state: 'failed', done: 0, total: 3, label: '', usage: u(0, 0), declined: 0, errors: 0, message: '로그인이 필요합니다. 터미널에서 claude 를 실행해 로그인하세요.' });
  expect(await screen.findByText('로그인이 필요합니다. 터미널에서 claude 를 실행해 로그인하세요.')).toBeVisible();
});
test('일시정지, 멈추기, 거절된 줄과 필터 칩, 다시 번역', async () => {
  await openFake({ glossary: confirmed, select: 'r-declined' });
  expect(screen.getByText('모델이 번역을 거절했습니다')).toBeVisible();
  expect(screen.getByRole('button', { name: '거절됨 1' })).toBeVisible();
  expect(screen.queryByRole('button', { name: /추천안 용어 사용/ })).toBeNull();
  await user.click(screen.getByRole('button', { name: '다시 번역' }));
  expect(api.calls.at(-1)).toEqual(['job.translate', ['r-declined']]);
  api.emit('job:progress', { kind: 'translate', state: 'running', done: 0, total: 1, label: '맵1 (1/1)', usage: u(0, 0), declined: 0, errors: 0 });
  await user.click(await screen.findByRole('button', { name: '일시정지' })); expect(api.calls.at(-1)).toEqual(['job.pause']);
  await user.click(screen.getByRole('button', { name: '멈추기' })); expect(api.calls.at(-1)).toEqual(['job.stop']);
});
test('검수 의견 그대로 두기, 확정 전 링크', async () => {
  await openFake({ select: reviewedId });
  await user.click(screen.getByRole('button', { name: '그대로 두기' })); expect(api.calls.at(-1)).toEqual(['unit.rejectReview', reviewedId]);
  await user.click(screen.getByRole('button', { name: '용어집으로' })); expect(useApp.get().view).toBe('glossary');
});
test('바뀐 내용 보기', async () => {
  await openFake({ select: itemId }); await user.type(screen.getByLabelText('번역'), '고치는 중');
  api.emit('project:changed', { rows: [{ ...itemRow, target: '채팅이 바꾼 값' }], stats, scopes, origin: 'chat' });
  await user.click(screen.getByRole('button', { name: '바뀐 내용 보기' }));
  expect((screen.getByLabelText('번역') as HTMLTextAreaElement).value).toBe('채팅이 바꾼 값');
  expect(screen.queryByText('다른 곳에서 이 줄이 바뀌었어요')).toBeNull();
  const nav = screen.getByRole('navigation', { name: '작업 메뉴' }); expect(within(nav).getByRole('button', { name: /용어집/ })).toBeVisible();
});
test('설정의 대본 읽기 모델: 비우면 용어집 정리와 같음', async () => {
  await openSettings();
  expect((screen.getByLabelText('대본 읽기') as HTMLSelectElement).value).toBe('');
  await user.selectOptions(screen.getByLabelText('대본 읽기'), 'claude-haiku-5-5');
  expect((api.calls.at(-1) as any)[1].stageModels.glossaryRead).toBe('claude-haiku-5-5');
  expect(screen.getByLabelText('용어집 정리')).toBeVisible();
});
