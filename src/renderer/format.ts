import type { Row } from '../shared/api';

const nf = new Intl.NumberFormat('ko-KR');

export function num(n: number): string {
  return nf.format(n);
}

export function pct(done: number, total: number): number {
  return total === 0 ? 0 : Math.round((done / total) * 100);
}

export function clock(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export const STATUS_LABEL = {
  untranslated: '미번역',
  translated: '번역 완료',
  'needs-review': '검토 필요',
  approved: '승인됨',
  error: '오류',
  declined: '거절됨',
} as const;

/** A line's status pill: its words and the class that gives it its meaning colour (theme.css .st-*). */
export function statusChip(r: Row): { label: string; cls: string } {
  if (r.status === 'untranslated' && r.needsDecision) return { label: '판단 필요', cls: 'st-warn' };
  const cls = { untranslated: 'st-none', translated: 'st-done', 'needs-review': 'st-warn', approved: 'st-ok', error: 'st-err', declined: 'st-err' }[r.status];
  return { label: STATUS_LABEL[r.status], cls };
}
