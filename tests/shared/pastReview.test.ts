import { expect, test } from 'vitest';
import type { TextUnit, TranslationEntry } from '../../src/core/types.js';
import { computeStats, filterRows, toRow } from '../../src/shared/rows.js';

const unit = (id: string): TextUnit => ({ id, kind: 'dialogue', source: id, needsDecision: false, refs: [{ type: 'value', file: 'data/Map001.json', path: [0] }] });
const past = (taken: 'suggestion' | 'before') => ({ problem: 'p', suggestion: '고친 안', model: 'm', before: '전', taken, at: '2026-11-16T00:00:00.000Z' });
const entry = (extra: Partial<TranslationEntry>): TranslationEntry => ({ target: '번역', status: 'translated', updatedAt: '', ...extra });

test('지난 검수 의견은 행에 실리고, 받은 것과 넘긴 것으로 걸러진다', () => {
  const rows = [
    toRow(unit('a'), entry({ pastReview: past('suggestion') })),
    toRow(unit('b'), entry({ pastReview: past('before') })),
    toRow(unit('c'), entry({})),
  ];
  expect(rows[0].pastReview).toEqual(past('suggestion')); expect(rows[2].pastReview).toBeUndefined();
  expect(filterRows(rows, { status: 'review-taken' }).map((r) => r.id)).toEqual(['a']);
  expect(filterRows(rows, { status: 'review-passed' }).map((r) => r.id)).toEqual(['b']);
  expect(computeStats(rows)).toMatchObject({ reviewTaken: 1, reviewPassed: 1 });
});
