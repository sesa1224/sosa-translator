import { expect, test } from 'vitest';
import { diffSnapshots, formatNotes, INSTALL_TEXT } from '../../src/core/notes/diff.js';
import { takeSnapshot, type BuildSnapshot } from '../../src/core/notes/snapshot.js';
import type { TextUnit, TranslationEntry } from '../../src/core/types.js';

const unit = (id: string, file: string): TextUnit => ({ id, kind: 'dialogue', source: id, needsDecision: false, refs: [{ type: 'value', file, path: [0] }] });
const units = [unit('a', 'data/Map001.json'), unit('b', 'data/Map001.json'), unit('c', 'data/Items.json'), unit('d', 'data/Map002.json'), unit('e', 'data/Map002.json')];
const entry = (target: string | null, status: TranslationEntry['status'] = 'needs-review'): TranslationEntry => ({ target, status, updatedAt: '2026-11-13T00:00:00.000Z' });

function snap(number: number, targets: Record<string, string | null>, images: Record<string, string> = {}, o: Partial<BuildSnapshot> = {}): BuildSnapshot {
  return takeSnapshot({
    number, version: 'v1', units, entryOf: (id) => (id in targets ? entry(targets[id]) : entry(null, 'untranslated')),
    images, files: ['data/Map001.json'], extras: {}, createdAt: '2026-11-13T00:00:00.000Z', ...o,
  });
}

test('스냅숏은 패치에 들어갈 수 있는 번역만, 짧은 해시로', () => {
  const s = takeSnapshot({
    number: 1, version: 'v1', units, images: {}, files: [], extras: {},
    entryOf: (id) => (id === 'a' ? entry('가') : id === 'b' ? entry('나', 'error') : id === 'c' ? entry(null, 'declined') : entry(null, 'untranslated')),
  });
  expect(Object.keys(s.translations)).toEqual(['a']);
  expect(s.translations.a).toMatch(/^[0-9a-f]{12}$/);
});

test('첫 빌드', () => {
  const d = diffSnapshots(null, snap(1, { a: '가', b: '나', c: '다' }), units);
  expect(d).toMatchObject({ number: 1, previous: null, newTranslations: 3, changedTranslations: 0, removedTranslations: 0 });
  const notes = formatNotes(d, { name: '약초원', version: 'v1' });
  expect(notes).toContain('약초원 한국어 패치 빌드 1');
  expect(notes).toContain('첫 빌드');
  expect(notes).toContain('새 번역 3줄');
});

test('둘째 빌드: 번역 2개 추가, 1개 수정, 그림 1장 추가', () => {
  const prev = snap(1, { a: '가', b: '나' }, { 'img/pictures/old.png': 'h1' });
  const cur = snap(2, { a: '가', b: '나나', d: '라', e: '마' }, { 'img/pictures/old.png': 'h1', 'img/pictures/menu.png': 'h2' }, { files: ['data/Map001.json', 'data/Map002.json'] });
  const d = diffSnapshots(prev, cur, units);
  expect(d).toMatchObject({ number: 2, previous: 1, newTranslations: 2, changedTranslations: 1, removedTranslations: 0 });
  expect(d.newImages).toEqual(['img/pictures/menu.png']);
  expect(d.changedImages).toEqual([]);
  expect(d.byScope).toEqual([{ label: '맵2', added: 2, changed: 0 }, { label: '맵1', added: 0, changed: 1 }]);
  expect(d.addedFiles).toEqual(['data/Map002.json']);
  const notes = formatNotes(d, { name: '약초원', version: 'v1' });
  expect(notes).toContain('빌드 1 대비');
  expect(notes).toContain('새 번역 2줄');
  expect(notes).toContain('고친 번역 1줄');
  expect(notes).toContain('맵2');
  expect(notes).toContain('img/pictures/menu.png');
  // Zero items give no line.
  expect(notes).not.toContain('빠진 번역');
  expect(notes).not.toContain('바뀐 그림');
  expect(notes).not.toContain('빠진 파일');
});

test('다른 계획이 넣은 요약의 더해짐과 빠짐', () => {
  const prev = snap(1, {}, {}, { extras: { patches: ['수정 A', '수정 B'] } });
  const cur = snap(2, {}, {}, { extras: { patches: ['수정 B', '수정 C'] } });
  const d = diffSnapshots(prev, cur, units);
  expect(d.extras.patches).toEqual({ added: ['수정 C'], removed: ['수정 A'] });
  expect(formatNotes(d, { name: 'x', version: 'v1' })).toContain('수정 C');
});

test('설치 방법: MV www 면 www 폴더를 말한다', () => {
  const plain = INSTALL_TEXT({ contentPrefix: '', name: '약초원' });
  expect(plain).toContain('백업');
  expect(plain).toContain('덮어');
  expect(plain).not.toContain('www');
  expect(INSTALL_TEXT({ contentPrefix: 'www/', name: '약초원' })).toContain('www');
});
