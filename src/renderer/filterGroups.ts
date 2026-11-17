// The text table's filter buttons, sorted into three groups so progress, things to fix and the rest no longer
// look alike: "상태" (where the translation stands), "살펴볼 것" (lines that want a hand) and "그 밖".
import type { Stats, StatusFilter } from '../shared/api';

/** The colour of a button's dot (and of its share in the progress bar). */
export type ChipTone = 'all' | 'none' | 'done' | 'ok' | 'warn' | 'err' | 'plain';
export interface FilterChip { key: StatusFilter; label: string; n: number; tone: ChipTone }
export type FilterGroupId = 'status' | 'attention' | 'other';
export interface FilterGroup { id: FilterGroupId; title: string; chips: FilterChip[] }

/**
 * The groups and their buttons. Buttons past the first few only show when they have lines (or are the filter in
 * use, for "창 넘침", so the filter can be left after the last overflow is fixed); `skipped` is counted by the
 * caller from the rows because the stats do not hold it.
 */
export function filterGroups(s: Stats, skipped: number, current: StatusFilter): FilterGroup[] {
  const status: FilterChip[] = [
    { key: 'all', label: '전체', n: s.total, tone: 'all' },
    { key: 'untranslated', label: '미번역', n: s.untranslated, tone: 'none' },
    { key: 'translated', label: '번역 완료', n: s.translated ?? 0, tone: 'done' },
    { key: 'needs-review', label: '검토 필요', n: s.needsReview, tone: 'warn' },
    { key: 'approved', label: '승인됨', n: s.approved, tone: 'ok' },
  ];
  const attention: FilterChip[] = [
    { key: 'error', label: '오류', n: s.error, tone: 'err' },
    { key: 'needs-decision', label: '판단 필요', n: s.needsDecision, tone: 'warn' },
  ];
  if (s.declined > 0) attention.push({ key: 'declined', label: '거절됨', n: s.declined, tone: 'err' });
  if (s.provisional > 0) attention.push({ key: 'provisional', label: '추천안 용어 사용', n: s.provisional, tone: 'warn' });
  if ((s.notation ?? 0) > 0) attention.push({ key: 'notation', label: '표기 경고', n: s.notation ?? 0, tone: 'warn' });
  if ((s.overflow ?? 0) > 0 || current === 'overflow') attention.push({ key: 'overflow', label: '창 넘침', n: s.overflow ?? 0, tone: 'warn' });
  const other: FilterChip[] = [];
  if ((s.external ?? 0) > 0) other.push({ key: 'external', label: '외부 번역', n: s.external, tone: 'plain' });
  if (skipped > 0) other.push({ key: 'skipped', label: '번역 안 함', n: skipped, tone: 'plain' });
  if ((s.changed ?? 0) > 0) other.push({ key: 'changed', label: '바뀐 문장', n: s.changed, tone: 'plain' });
  if ((s.reviewTaken ?? 0) > 0) other.push({ key: 'review-taken', label: '검수로 바뀜', n: s.reviewTaken ?? 0, tone: 'plain' });
  if ((s.reviewPassed ?? 0) > 0) other.push({ key: 'review-passed', label: '검수 의견 넘김', n: s.reviewPassed ?? 0, tone: 'plain' });
  const groups: FilterGroup[] = [
    { id: 'status', title: '상태', chips: status },
    { id: 'attention', title: '살펴볼 것', chips: attention },
  ];
  if (other.length > 0) groups.push({ id: 'other', title: '그 밖', chips: other });
  return groups;
}

export interface ProgressPart { tone: ChipTone; share: number }

/**
 * The thin bar under "상태": untranslated, translated, needs-review and approved as shares of all lines. These
 * four are values of one row status, so they never overlap and add up to at most 100%; error and declined rows
 * are the part left empty.
 */
export function progressParts(s: Stats): ProgressPart[] {
  if (s.total <= 0) return [];
  const parts: [ChipTone, number][] = [['none', s.untranslated], ['done', s.translated ?? 0], ['warn', s.needsReview], ['ok', s.approved]];
  return parts.filter(([, n]) => n > 0).map(([tone, n]) => ({ tone, share: n / s.total }));
}
