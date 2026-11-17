import { expect, test } from 'vitest';
import { filterGroups, progressParts } from '../../src/renderer/filterGroups';
import type { Stats, StatusFilter } from '../../src/shared/api';

const stats = (o: Partial<Stats> = {}): Stats => ({
  total: 0, untranslated: 0, needsReview: 0, approved: 0, error: 0, needsDecision: 0, declined: 0, provisional: 0, external: 0, undecided: 0,
  changed: 0, carried: 0, translated: 0, reviewTaken: 0, reviewPassed: 0, notation: 0, overflow: 0, ...o,
});

const ALL_FILTERS: StatusFilter[] = ['all', 'untranslated', 'translated', 'needs-review', 'approved', 'error', 'declined', 'needs-decision', 'provisional',
  'external', 'skipped', 'changed', 'review-taken', 'review-passed', 'notation', 'overflow'];

test('거르기는 빠짐없이 셋 중 한 묶음에만', () => {
  const full = stats({ total: 9, untranslated: 1, translated: 1, needsReview: 1, approved: 1, error: 1, declined: 1, needsDecision: 1, provisional: 1,
    external: 1, changed: 1, reviewTaken: 1, reviewPassed: 1, notation: 1, overflow: 1 });
  const groups = filterGroups(full, 1, 'all');
  expect(groups.map((g) => [g.id, g.title])).toEqual([['status', '상태'], ['attention', '살펴볼 것'], ['other', '그 밖']]);
  const keys = groups.flatMap((g) => g.chips.map((c) => c.key));
  expect([...keys].sort()).toEqual([...ALL_FILTERS].sort());
  expect(groups[0].chips.map((c) => c.label)).toEqual(['전체', '미번역', '번역 완료', '검토 필요', '승인됨']);
  expect(groups[1].chips.map((c) => c.key)).toEqual(['error', 'needs-decision', 'declined', 'provisional', 'notation', 'overflow']);
  expect(groups[2].chips.map((c) => c.key)).toEqual(['external', 'skipped', 'changed', 'review-taken', 'review-passed']);
});

test('조건부 단추는 수가 있을 때만(창 넘침은 거르는 중에도), 그 밖이 비면 묶음째 없다', () => {
  const groups = filterGroups(stats({ total: 3, untranslated: 3 }), 0, 'all');
  expect(groups.map((g) => g.id)).toEqual(['status', 'attention']);
  expect(groups[0].chips).toHaveLength(5);
  expect(groups[1].chips.map((c) => c.key)).toEqual(['error', 'needs-decision']);
  expect(filterGroups(stats(), 0, 'overflow')[1].chips.map((c) => c.key)).toContain('overflow');
});

test('비율 막대: 겹치지 않는 네 상태만, 전체에 대한 몫', () => {
  // needsDecision and external overlap the statuses, so they must not add to the bar.
  const s = stats({ total: 10, untranslated: 2, translated: 5, needsReview: 1, approved: 1, error: 1, needsDecision: 4, external: 6 });
  const parts = progressParts(s);
  expect(parts).toEqual([{ tone: 'none', share: 0.2 }, { tone: 'done', share: 0.5 }, { tone: 'warn', share: 0.1 }, { tone: 'ok', share: 0.1 }]);
  expect(parts.reduce((a, p) => a + p.share, 0)).toBeLessThanOrEqual(1);
  expect(progressParts(stats())).toEqual([]);
});
