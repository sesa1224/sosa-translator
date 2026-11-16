import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { defaultGlossary, loadGlossary, saveGlossary, termId } from '../../src/core/glossary/store.js';
import type { Row } from '../../src/shared/api.js';
import { computeStats, filterRows } from '../../src/shared/rows.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';

let proj: string;
beforeAll(async () => { proj = await makeTempDir(); });
afterAll(() => cleanupTempDirs());

function row(id: string, p: Partial<Row> = {}): Row {
  return { id, kind: 'dialogue', source: id, target: null, status: 'untranslated', needsDecision: false, file: 'data/Map001.json',
    location: '', refCount: 1, usesProvisional: false, ...p };
}

/** n declined rows, n provisional rows (translated, using a provisional term) and two plain rows. */
function rowsWith(n: { declined: number; provisional: number }): Row[] {
  const out: Row[] = [row('plain-1'), row('plain-2', { target: '번역', status: 'approved' })];
  for (let i = 0; i < n.declined; i++) out.push(row(`d${i}`, { status: 'declined', declinedReason: '사유' }));
  for (let i = 0; i < n.provisional; i++) out.push(row(`p${i}`, { target: '번역', status: 'needs-review', usesProvisional: true }));
  return out;
}
const rows = rowsWith({ declined: 2, provisional: 3 });

test('기본 지침이 들어간다', () => {
  const g = defaultGlossary(); expect(g.styleGuide).toContain('의성어, 의태어, 신음'); expect(g.styleGuide).toContain('찌걱찌걱');
  expect(g.styleGuide.startsWith('# 기본 번역 지침')).toBe(false); expect(g.confirmedAt).toBeNull(); expect(g.rules.speakerPattern).toBeNull();
});
test('저장하고 읽기, 빠진 필드 채우기', async () => {
  const g = defaultGlossary(); g.terms.push({ id: termId('玃猿'), source: '玃猿', target: '확원', category: 'term', status: 'confirmed', candidates: [] });
  await saveGlossary(proj, g); expect((await loadGlossary(proj)).terms[0].target).toBe('확원');
  await writeFile(path.join(proj, 'glossary.json'), JSON.stringify({ terms: [] })); expect((await loadGlossary(proj)).rules.maxLines).toBe(4);
});
test('새 상태를 센다', () => {
  expect(computeStats(rowsWith({ declined: 2, provisional: 3 }))).toMatchObject({ declined: 2, provisional: 3 });
  expect(filterRows(rows, { status: 'declined' }).every(r => r.status === 'declined')).toBe(true);
  expect(filterRows(rows, { status: 'provisional' }).every(r => r.usesProvisional)).toBe(true);
});

// Extra coverage beyond the plan's assertions.
test('없는 파일은 기본값, 기본 지침은 안내 문단을 뺀다', async () => {
  const g = await loadGlossary(await makeTempDir());
  expect(g).toEqual(defaultGlossary());
  expect(g.styleGuide.startsWith('## 기본 태도')).toBe(true);
  expect(g.rules).toEqual({ controlCodes: true, noLeftoverJapanese: true, sameLineCount: false, maxLines: 4, maxLineWidthChars: null, speakerPattern: null, halfWidth: true, halfWidthBrackets: true });
  expect(termId('玃猿')).toMatch(/^[0-9a-f]{12}$/);
  expect(filterRows(rows, { status: 'provisional' })).toHaveLength(3);
});
