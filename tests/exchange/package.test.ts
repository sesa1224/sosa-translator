import { expect, test } from 'vitest';
import { buildPackage, planImport } from '../../src/core/exchange/package.js';
import { defaultGlossary, termId } from '../../src/core/glossary/store.js';
import type { Glossary } from '../../src/core/glossary/types.js';
import type { Decisions } from '../../src/core/decisions/types.js';
import type { ProjectMeta } from '../../src/core/project/project.js';
import type { TextUnit, TranslationEntry } from '../../src/core/types.js';

const meta: ProjectMeta = { name: '약초원', engine: 'MZ', gameDir: 'C:/g', contentPrefix: '', sourceLang: 'ja', targetLang: 'ko', versions: [{ id: 'v1', importedAt: '' }], current: 'v1' };
const ref = (n: number) => ({ type: 'value' as const, file: 'data/Map001.json', path: [n] });
const units: TextUnit[] = [
  { id: 'd0', kind: 'dialogue', source: '最初の言葉', needsDecision: false, refs: [ref(0)] },
  { id: 'd1', kind: 'dialogue', source: '【リナ】\n月光草を探して', needsDecision: false, refs: [ref(1)] },
  { id: 'd2', kind: 'dialogue', source: 'あれ？\\N[1]じゃない！', needsDecision: false, refs: [ref(2)] },
  { id: 'd3', kind: 'dialogue', source: '最後の言葉', needsDecision: false, refs: [ref(3)] },
  { id: 'p1', kind: 'plugin-command', source: 'D_TEXT 筋力 32', needsDecision: true, decisionKey: 'mv:D_TEXT', refs: [ref(4)] },
  { id: 'i1', kind: 'db', source: '霧の森', needsDecision: false, refs: [{ type: 'value', file: 'data/Items.json', path: [1, 'name'] }] },
];

function glossary(): Glossary {
  const g = defaultGlossary();
  g.styleGuide = '반말은 쓰지 않는다.';
  g.rules.speakerPattern = '^【(.+?)】$';
  g.terms = [
    { id: termId('月光草'), source: '月光草', target: '월광초', category: 'term', status: 'confirmed', candidates: [] },
    { id: termId('霧の森'), source: '霧の森', target: '안개 숲', category: 'place', status: 'confirmed', candidates: [] },
    { id: termId('リナ'), source: 'リナ', target: '리나', category: 'name', status: 'confirmed', candidates: [] },
  ];
  g.characters = [{ id: 'c1', source: 'リナ', target: '리나', speech: '존댓말', moanStyle: '짧게' }];
  return g;
}
const decisions: Decisions = { 'mv:D_TEXT': { translate: true, keep: { mode: 'args', from: 1, dropLast: 1 }, status: 'confirmed', by: 'user' } };

function store(entries: Record<string, Partial<TranslationEntry>> = {}) {
  return (id: string): TranslationEntry => ({ target: null, status: 'untranslated', updatedAt: '', ...entries[id] });
}

test('꾸러미: 용어, 지침, 화자, keep, 앞뒤 대사', () => {
  const pkg = buildPackage({ meta, units, entryOf: store({ d0: { target: '첫 말', status: 'approved' } }), glossary: glossary(), decisions, ids: ['d1', 'd2', 'p1'] });
  expect(pkg.format).toBe('mvmz-exchange-1');
  expect(pkg.project).toBe('약초원');
  expect(pkg.replyFormat).toBe('[{ "id": "...", "target": "..." }]');
  expect(pkg.terms.map((t) => t.source).sort()).toEqual(['リナ', '月光草']);
  expect(pkg.instructions).toContain('반말은 쓰지 않는다.');
  expect(pkg.instructions).toContain('제어문자');
  expect(pkg.characters).toEqual([{ name: 'リナ', target: '리나', speech: '존댓말', moanStyle: '짧게' }]);
  const d1 = pkg.items.find((i) => i.id === 'd1')!;
  expect(d1).toMatchObject({ speaker: 'リナ', text: '月光草を探して' });
  expect(d1.before).toEqual([{ speaker: null, source: '最初の言葉', target: '첫 말' }]);
  expect(d1.after.map((a) => a.source)).toEqual(['あれ？\\N[1]じゃない！', '最後の言葉']);
  expect(pkg.items.find((i) => i.id === 'p1')!.keep).toEqual(['D_TEXT ', ' 32']);
  expect(pkg.items.find((i) => i.id === 'd2')!.keep).toBeUndefined();
});

test('planImport: 모르는 id, 충돌, 같음, 새 번역, 검사 오류', () => {
  const entryOf = store({ d0: { target: '첫 말', status: 'approved' }, d3: { target: '끝 말', status: 'needs-review' } });
  const plan = planImport(units, entryOf, glossary(), decisions, [
    { id: 'nope', target: 'x' },
    { id: 'd0', target: '다른 첫 말' },
    { id: 'd3', target: '끝 말' },
    { id: 'd1', target: '월광초를 찾아줘' },
    { id: 'd2', target: '어라? 아니잖아!' },
    { id: 'p1', target: 'D_TEXT 근력 32' },
  ]);
  expect(plan.unknownIds).toEqual(['nope']);
  expect(plan.conflicts).toEqual([{ id: 'd0', current: '첫 말', incoming: '다른 첫 말' }]);
  expect(plan.ok.map((o) => o.id)).toEqual(['d1', 'd2', 'p1']);
  expect(plan.ok[0].target).toBe('【리나】\n월광초를 찾아줘');
  expect(plan.ok[0].issues).toEqual([]);
  expect(plan.ok[1].issues.some((i) => i.severity === 'error' && i.rule === 'control-codes')).toBe(true);
  expect(plan.ok[2].issues).toEqual([]);
  expect(plan.invalid).toBe(0);
});

test('모양이 틀린 입력은 invalid 로 센다', () => {
  const p = planImport(units, store(), glossary(), decisions, [{ id: 'd1' }, { id: 3, target: 'x' }, null, 'str', { id: 'd0', target: '좋아' }] as never);
  expect(p.invalid).toBe(4);
  expect(p.ok.map((o) => o.id)).toEqual(['d0']);
  expect(planImport(units, store(), glossary(), decisions, { not: 'array' } as never)).toEqual({ ok: [], conflicts: [], unknownIds: [], invalid: 1 });
});
