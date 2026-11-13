import { act, cleanup, screen, within } from '@testing-library/react';
import { type UserEvent } from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { useApp } from '../../src/renderer/state';
import type { Glossary, Row, Term } from '../../src/shared/api';
import { baseRows, fakeApi, openFakeWith, type FakeApi } from './fakeApi';

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
  await openGlossary({ terms: [] }); await user.click(screen.getByRole('button', { name: '초안 받기' })); expect(api.calls).toContainEqual(['job.draft']);
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
test('말투 지침, 인물 카드, 형식 규칙', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    await openGlossary({ characters: [{ id: 'c1', source: 'リナ', target: '리나', speech: '반말' }] });
    const guide = screen.getByLabelText('말투 지침');
    await user.type(guide, '추가');
    await act(async () => { vi.advanceTimersByTime(900); });
    expect(api.calls.some(c => c[0] === 'glossary.setStyleGuide' && String(c[1]).endsWith('추가'))).toBe(true);
    const speech = screen.getByLabelText('リナ 말투');
    await user.clear(speech); await user.type(speech, '존댓말'); await user.tab();
    expect(api.calls).toContainEqual(['glossary.setCharacters', [{ id: 'c1', source: 'リナ', target: '리나', speech: '존댓말' }]]);
    await user.click(screen.getByLabelText('줄 수를 원문과 같게'));
    expect(api.calls).toContainEqual(['glossary.setRules', { sameLineCount: true }]);
    const width = screen.getByLabelText('한 줄 최대 글자 수');
    await user.type(width, '28'); await user.tab();
    expect(api.calls).toContainEqual(['glossary.setRules', { maxLineWidthChars: 28 }]);
    await user.selectOptions(screen.getByLabelText('화자 줄 패턴'), 'bracket');
    expect(api.calls.at(-1)?.[0]).toBe('glossary.setRules');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await user.click(screen.getByRole('button', { name: '기본 지침으로 되돌리기' }));
    expect(api.calls).toContainEqual(['glossary.setStyleGuide', '기본 지침']);
  } finally {
    vi.useRealTimers();
  }
});
