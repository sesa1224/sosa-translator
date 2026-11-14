import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { exportUntranslated, importTranslations, TranslationStore } from '../../src/core/store/translations.js';
import type { TextUnit } from '../../src/core/types.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';
import { setupProject } from '../helpers/project.js';

let proj: string;
let units: TextUnit[];
let store: TranslationStore;

beforeAll(async () => {
  ({ units, store } = await setupProject());
  proj = await makeTempDir();
});
afterAll(cleanupTempDirs);

test('기본값, 저장, 다시 읽기', async () => {
  const s = await TranslationStore.load(proj);
  expect(s.get('x')).toEqual({ target: null, status: 'untranslated', updatedAt: '' });
  s.set('a1', '월광초'); expect(s.get('a1').status).toBe('translated');
  s.setStatus('a1', 'approved'); await s.save();
  expect((await TranslationStore.load(proj)).get('a1')).toMatchObject({ target: '월광초', status: 'approved' });
  expect(existsSync(path.join(proj, 'translations.json'))).toBe(true);
});
test('예전의 기본 상태였던 검토 필요는 번역 완료로 읽고, 일부러 올린 것은 그대로 둔다', async () => {
  const dir = await makeTempDir();
  const at = '2026-11-13T00:00:00.000Z';
  await writeFile(path.join(dir, 'translations.json'), JSON.stringify({
    old: { target: '가', status: 'needs-review', updatedAt: at },
    remark: { target: '나', status: 'needs-review', updatedAt: at, review: { problem: 'p', suggestion: 's', model: 'm' } },
    carried: { target: '다', status: 'needs-review', updatedAt: at, carried: true },
    flagged: { target: '라', status: 'needs-review', updatedAt: at, flagged: true },
  }));
  const s = await TranslationStore.load(dir);
  expect(['old', 'remark', 'carried', 'flagged'].map(id => s.get(id).status)).toEqual(['translated', 'needs-review', 'needs-review', 'needs-review']);
});
test('검토 필요로 올리면 표시가 남고, 다른 상태로 가면 지워진다', async () => {
  const s = await TranslationStore.load(await makeTempDir());
  s.set('a', '가'); s.setStatus('a', 'needs-review'); expect(s.get('a').flagged).toBe(true);
  s.setStatus('a', 'translated'); expect(s.get('a').flagged).toBeUndefined();
  s.set('b', '나', 'needs-review'); expect(s.get('b').flagged).toBe(true);
});
test('미번역 내보내기는 판단 필요 항목을 뺀다', () => {
  const out = exportUntranslated(units, store);
  expect(out.some(o => o.source === '記録')).toBe(false);
  expect(out.find(o => o.source.startsWith('あれ？'))).toMatchObject({ kind: 'dialogue', speaker: 'リナ' });
  expect(exportUntranslated(units, store, { includeNeedsDecision: true }).some(o => o.source === '記録')).toBe(true);
});
test('가져오기: 모르는 id 는 돌려준다', () => {
  const r = importTranslations(units, store, [{ id: units[0].id, target: '가' }, { id: 'nope', target: '나' }]);
  expect(r).toEqual({ applied: 1, unknownIds: ['nope'] }); expect(store.get('nope').target).toBeNull();
  expect(exportUntranslated(units, store).some(o => o.id === units[0].id)).toBe(false);
});
