import { act, cleanup, screen, within } from '@testing-library/react';
import { type UserEvent } from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { useApp } from '../../src/renderer/state';
import type { Glossary, Row, Term } from '../../src/shared/api';
import { baseRows, defaultFakeGlossary, fakeApi, openFakeWith, type FakeApi } from './fakeApi';

let api: FakeApi;
let user: UserEvent;

const provisionalOtome: Term = {
  id: 'otome', source: '乙女', target: '오토메', category: 'name', status: 'provisional',
  candidates: [{ target: '오토메', reason: '사람 이름으로 보임' }, { target: '처녀', reason: '일반 명사로 읽을 때' }],
};
const T = (id: string, source: string, target: string, category: Term['category']): Term => ({ id, source, target, category, status: 'confirmed', candidates: [] });
const fiveTerms: Term[] = [T('a', 'リナ', '리나', 'name'), T('b', '薬草園', '약초원', 'place'), T('c', '月光草', '월광초', 'term'),
  T('d', 'ぐちゅぐちゅ', '찌걱찌걱', 'sfx'), T('e', '記録', '기록', 'other')];

/** 23 translated lines that use 乙女, plus one that does not have a translation yet. */
const otomeRows: Row[] = [
  ...Array.from({ length: 23 }, (_, i): Row => ({ id: `o${i}`, kind: 'dialogue', source: `乙女${i}`, target: `오토메${i}`, status: 'needs-review',
    needsDecision: false, file: 'data/Map001.json', location: `맵1 · 이벤트${i}`, refCount: 1, usesProvisional: true })),
  { id: 'o-untr', kind: 'dialogue', source: '乙女は首を振った', target: null, status: 'untranslated', needsDecision: false, file: 'data/Map001.json', location: '맵1', refCount: 1, usesProvisional: false },
];

async function openGlossary(g: Partial<Glossary> = {}) {
  cleanup();
  api = fakeApi({ glossary: g, rows: [...baseRows, ...otomeRows] });
  user = await openFakeWith(api);
  act(() => { useApp.setView('glossary'); });
  await screen.findByRole('heading', { name: '용어집' });
}

test('후보를 고른다', async () => {
  await openGlossary({ terms: [provisionalOtome] }); expect(screen.getByText('추천안으로 진행 중 · 23문장')).toBeVisible();
  api.chooseResult = { changed: ['o1', 'o2', 'o3'], uncertain: ['o1', 'o2'] };
  await user.click(screen.getByRole('button', { name: /처녀/ })); expect(api.calls).toContainEqual(['glossary.choose', provisionalOtome.id, '처녀']);
  expect(await screen.findByText('조사를 확인할 문장 2개')).toBeVisible();
});
test('직접 입력', async () => {
  await openGlossary({ terms: [provisionalOtome] }); await user.click(screen.getByRole('button', { name: '직접 입력' }));
  await user.type(screen.getByLabelText('乙女 번역'), '소녀{Enter}'); expect(api.calls).toContainEqual(['glossary.choose', provisionalOtome.id, '소녀']);
});
test('분류 필터와 새 용어', async () => {
  await openGlossary({ terms: fiveTerms }); await user.click(screen.getByRole('button', { name: '효과음' })); expect(screen.getAllByTestId('term-row')).toHaveLength(1);
  await user.type(screen.getByLabelText('새 용어 원문'), 'ギルド'); await user.type(screen.getByLabelText('새 용어 번역'), '길드{Enter}');
  expect(api.calls.at(-1)).toEqual(['glossary.upsertTerm', { source: 'ギルド', target: '길드', category: 'term', status: 'confirmed', candidates: [] }]);
});
test('확정과 초안', async () => {
  await openGlossary({ terms: [] }); await user.click(screen.getByRole('button', { name: '초안 받기' }));
  await user.click(screen.getByLabelText('표본만 보고 빠르게 만들기')); await user.click(await screen.findByRole('button', { name: '시작' }));
  expect(api.calls).toContainEqual(['job.draft', 'sample', { mergeModel: 'claude-fable-5-2' }]);
  await user.click(screen.getByRole('button', { name: '용어집 확정' })); expect(api.calls).toContainEqual(['glossary.confirm']);
});
test('화자 줄 패턴 자동 찾기', async () => {
  await openGlossary(); api.speakerDetection = { pattern: 'x', presetId: 'bracket', coverage: 0.97 };
  await user.click(screen.getByRole('button', { name: '자동으로 찾기' })); expect(await screen.findByText('대사의 97%가 맞아요')).toBeVisible();
});

// Extra coverage beyond the plan's assertions.
test('요약, 결정 수, 검색, 번역 고치기와 삭제', async () => {
  await openGlossary({ terms: [provisionalOtome, ...fiveTerms] });
  expect(screen.getByText('용어 5개 확정 · 1개는 추천안으로 진행 중이에요')).toBeVisible();
  expect(screen.getByRole('button', { name: '초안 다시 받기' })).toBeVisible();
  expect(within(screen.getByRole('navigation', { name: '작업 메뉴' })).getByRole('button', { name: /용어집\s*1/ })).toBeVisible();
  await user.type(screen.getByLabelText('용어 검색'), '月光');
  expect(screen.getAllByTestId('term-row')).toHaveLength(1);
  const input = screen.getByLabelText('月光草 번역 고치기');
  await user.clear(input); await user.type(input, '달빛풀{Enter}');
  expect(api.calls).toContainEqual(['glossary.choose', 'c', '달빛풀']);
  await user.click(screen.getByRole('button', { name: '月光草 삭제' }));
  expect(api.calls.at(-1)).toEqual(['glossary.removeTerm', 'c']);
});
test('보기 누르면 그 줄만 보인다, 확정 날짜', async () => {
  await openGlossary({ terms: [provisionalOtome], confirmedAt: '2026-11-13T03:00:00.000Z' });
  expect(screen.getByRole('button', { name: /확정됨/ })).toBeDisabled();
  api.chooseResult = { changed: ['o1', 'o2'], uncertain: ['o1', 'o2'] };
  await user.click(screen.getByRole('button', { name: /오토메/ }));
  await user.click(await screen.findByRole('button', { name: '보기' }));
  expect(useApp.get().view).toBe('text');
  expect(await screen.findByText('2줄')).toBeVisible();
});
test('인물 카드, 형식 규칙, 번역 지침으로 가기', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    await openGlossary({ characters: [{ id: 'c1', source: 'リナ', target: '리나', speech: '반말' }] });
    const speech = screen.getByLabelText('リナ 말투');
    await user.clear(speech); await user.type(speech, '존댓말'); await user.tab();
    expect(api.calls).toContainEqual(['glossary.setCharacters', [{ id: 'c1', source: 'リナ', target: '리나', speech: '존댓말' }]]);
    await user.click(screen.getByLabelText('줄 수를 원문과 같게'));
    expect(api.calls).toContainEqual(['glossary.setRules', { sameLineCount: true }]);
    await user.click(screen.getByLabelText('괄호 （ ）도 반각으로'));
    expect(api.calls).toContainEqual(['glossary.setRules', { halfWidthBrackets: false }]);
    const width = screen.getByLabelText('한 줄 최대 글자 수');
    await user.type(width, '28'); await user.tab();
    expect(api.calls).toContainEqual(['glossary.setRules', { maxLineWidthChars: 28 }]);
    await user.selectOptions(screen.getByLabelText('화자 줄 패턴'), 'bracket');
    expect(api.calls.at(-1)?.[0]).toBe('glossary.setRules');
    await user.click(screen.getByRole('button', { name: '번역 지침 열기' })); expect(useApp.get().view).toBe('guide');
  } finally {
    vi.useRealTimers();
  }
});
test('인물 카드의 신음·감탄 스타일', async () => {
  await openGlossary({ characters: [{ id: 'c1', source: 'リナ', target: '리나', speech: '반말' }] });
  await user.type(screen.getByLabelText('リナ 신음·감탄 스타일'), '참다가 새는 짧은 소리'); await user.tab();
  expect(api.calls).toContainEqual(['glossary.setCharacters', [{ id: 'c1', source: 'リナ', target: '리나', speech: '반말', moanStyle: '참다가 새는 짧은 소리' }]]);
});
test('초안 대화상자: 추정치, 읽는 양, 두 모델', async () => {
  await openGlossary({ terms: [] }); await user.click(screen.getByRole('button', { name: '초안 받기' }));
  expect(await screen.findByText('조각 3개 · 약 48,000자 · 예상 입력 약 62,000 토큰 · 모델 Claude Fable 5.2')).toBeVisible();
  expect(screen.getByLabelText('대본 읽기')).toBeVisible();
  await user.click(screen.getByLabelText('많이 (약 10만 자)'));
  await user.selectOptions(screen.getByLabelText('대본 읽기'), 'claude-haiku-5-5');
  await user.selectOptions(screen.getByLabelText('용어집 정리'), 'claude-opus-5-5');
  expect(api.calls.at(-1)).toEqual(['job.draftPlan', 'balanced', { mergeModel: 'claude-opus-5-5', budgetChars: 100000, readModel: 'claude-haiku-5-5' }]);
  await user.click(screen.getByRole('button', { name: '시작' }));
  expect(api.calls.at(-1)).toEqual(['job.draft', 'balanced', { mergeModel: 'claude-opus-5-5', budgetChars: 100000, readModel: 'claude-haiku-5-5' }]);
});
test('초안 대화상자: 표본 방식은 대본 읽기 칸을 숨기고, 같은 모델이면 이름 하나', async () => {
  await openGlossary({ terms: [] }); await user.click(screen.getByRole('button', { name: '초안 받기' }));
  await user.click(screen.getByLabelText('대본 전체를 읽고 만들기'));
  expect(api.calls.at(-1)).toEqual(['job.draftPlan', 'full', { mergeModel: 'claude-fable-5-2', readModel: 'claude-fable-5-2' }]);
  await user.click(screen.getByLabelText('표본만 보고 빠르게 만들기'));
  expect(screen.queryByLabelText('대본 읽기')).toBeNull();
  expect(await screen.findByText(/^표본 · 약 48,000자/)).toBeVisible();
});
test('이름 용어를 화자 이름에만 적용하게 켜고 끈다', async () => {
  await openGlossary({ terms: fiveTerms });
  expect(screen.queryByLabelText('薬草園 화자 이름에만 적용')).toBeNull();
  await user.click(screen.getByLabelText('リナ 화자 이름에만 적용'));
  expect(api.calls.at(-1)).toEqual(['glossary.upsertTerm', { source: 'リナ', target: '리나', category: 'name', status: 'confirmed', candidates: [], scope: 'speaker' }]);
  await openGlossary({ terms: [{ ...fiveTerms[0], scope: 'speaker' }] });
  expect(screen.getByLabelText('リナ 화자 이름에만 적용')).toBeChecked();
  await user.click(screen.getByLabelText('リナ 화자 이름에만 적용'));
  expect(api.calls.at(-1)).toEqual(['glossary.upsertTerm', { source: 'リナ', target: '리나', category: 'name', status: 'confirmed', candidates: [] }]);
});

test('표기 검사 규칙: 끄면 가린 글자 규칙도 잠긴다', async () => {
  await openGlossary();
  await user.click(screen.getByLabelText('표기 검사'));
  expect(api.calls).toContainEqual(['glossary.setRules', { notationCheck: false }]);
  await user.click(screen.getByLabelText('가린 글자는 풀어서 쓰기'));
  expect(api.calls).toContainEqual(['glossary.setRules', { unmask: false }]);
  cleanup();
  await openGlossary({ rules: { ...defaultFakeGlossary().rules, notationCheck: false } });
  expect(screen.getByLabelText('가린 글자는 풀어서 쓰기')).toBeDisabled();
});
