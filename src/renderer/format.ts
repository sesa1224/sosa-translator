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
  'needs-review': '검토 필요',
  approved: '승인됨',
  error: '오류',
} as const;
