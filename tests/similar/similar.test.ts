import { expect, test } from 'vitest';
import { buildSimilarIndex, findSimilar, similarityKey, type SimilarCandidate } from '../../src/core/similar/find.js';

const C = (id: string, source: string, target = `번역 ${id}`): SimilarCandidate => ({ id, source, target });

test('비교할 글은 제어문자와 공백을 뺀 것', () => {
  expect(similarityKey('\\C[2]こんな 夜に\\C[0]\n来るなんて%1')).toBe('こんな夜に来るなんて');
});

test('일치율이 높은 순으로, 0~100 정수', () => {
  const hits = findSimilar('こんな夜に来るなんて', [
    C('far', 'こんな朝に帰るなんてひどい'),
    C('near', 'こんな夜に来るなんてね'),
    C('none', 'ありがとうございました'),
  ]);
  // 'far' shares 5 of its 12 pairs (48%), under the default 60.
  expect(hits.map((h) => h.id)).toEqual(['near']);
  expect(hits[0]).toMatchObject({ id: 'near', source: 'こんな夜に来るなんてね', target: '번역 near' });
  expect(Number.isInteger(hits[0].score)).toBe(true);
  expect(hits[0].score).toBeGreaterThan(80);
  expect(hits[0].score).toBeLessThanOrEqual(100);
  expect(hits.some((h) => h.id === 'none')).toBe(false);
});

test('제어문자와 공백이 달라도 같은 글이면 100', () => {
  const hits = findSimilar('\\C[2]月光草\\C[0]を探して', [C('a', '月光草を 探して%1')]);
  expect(hits).toEqual([{ id: 'a', source: '月光草を 探して%1', target: '번역 a', score: 100 }]);
});

test('미번역, 자기 자신, 원문이 똑같은 문장은 뺀다', () => {
  const src = 'こんな夜に来るなんて';
  const hits = findSimilar(src, [
    C('self', 'こんな夜に来るなんてね'),
    C('empty', 'こんな夜に来るなんてな', ''),
    C('same', src),
    C('ok', 'こんな夜に来るなんてさ'),
  ], { excludeId: 'self' });
  expect(hits.map((h) => h.id)).toEqual(['ok']);
});

test('원문이 4자 미만이면 찾지 않는다', () => {
  expect(findSimilar('やった', [C('a', 'やったね')])).toEqual([]);
  // Control codes do not count toward the length.
  expect(findSimilar('\\C[2]やった\\C[0]', [C('a', 'やったね')])).toEqual([]);
});

test('문턱과 개수', () => {
  const cands = [C('a', 'こんな夜に来るなんてa'), C('b', 'こんな夜に来るなんてbb'), C('c', 'こんな夜に来るなんてccc'), C('d', 'こんな夜に来るなんてdddd')];
  expect(findSimilar('こんな夜に来るなんて', cands)).toHaveLength(3);
  expect(findSimilar('こんな夜に来るなんて', cands, { limit: 10 })).toHaveLength(4);
  expect(findSimilar('こんな夜に来るなんて', cands, { minScore: 92, limit: 10 }).map((h) => h.id)).toEqual(['a']);
  expect(findSimilar('こんな夜に来るなんて', [C('x', '月が綺麗ですね本当に')])).toEqual([]);
});

test('색인을 만들어 두고 여러 번 찾아도 같은 결과', () => {
  const cands = [C('a', 'こんな夜に来るなんてね'), C('b', 'こんな朝に来るなんてね'), C('c', '全然違う文章です')];
  const index = buildSimilarIndex(cands);
  expect(findSimilar('こんな夜に来るなんて', index)).toEqual(findSimilar('こんな夜に来るなんて', cands));
  expect(findSimilar('こんな朝に来るなんて', index)[0].id).toBe('b');
});

test('수만 문장에서도 빠르다', () => {
  const kana = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん';
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const sentence = () => Array.from({ length: 12 + Math.floor(rnd() * 20) }, () => kana[Math.floor(rnd() * kana.length)]).join('');
  const cands = Array.from({ length: 30000 }, (_, i) => C(`u${i}`, sentence()));
  const index = buildSimilarIndex(cands);
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) findSimilar(cands[i].source, index, { excludeId: cands[i].id });
  expect((performance.now() - t0) / 20).toBeLessThan(50);
});
