import { expect, test } from 'vitest';
import { actionDetail, clipLine, DETAIL_LIMIT, summarize } from '../../src/core/history/store.js';
import type { ActionChange, ActionRecord } from '../../src/core/history/types.js';
import type { TextUnit, TranslationEntry } from '../../src/core/types.js';

const entry = (target: string | null, status: TranslationEntry['status'] = 'translated'): TranslationEntry => ({ target, status, updatedAt: '2026-11-16T00:00:00.000Z' });
const unit = (id: string, source: string, file = 'data/Map004.json'): TextUnit => ({
  id, kind: 'dialogue', source, needsDecision: false, refs: [{ type: 'value', file, path: ['events', 3, 'pages', 1, 'list', 0] } as any],
});
const change = (unitId: string, before: TranslationEntry, after: TranslationEntry): ActionChange => ({ unitId, before, after });
const record = (changes: ActionChange[]): ActionRecord => ({ id: 'a1', at: '2026-11-16T10:00:00.000Z', origin: 'chat', label: '채팅에서 바꿈 1개', changes });
const units = new Map([['u1', unit('u1', 'メッセージ速度')], ['u2', unit('u2', '月光草')], ['u3', unit('u3', 'リナ')]]);
const sourceOf = (id: string) => units.get(id)?.source;

test('한 줄: 원문과 바뀐 뒤 번역', () => {
  const s = summarize(record([change('u1', entry(null, 'untranslated'), entry('메시지 속도'))]), sourceOf);
  expect(s.preview).toEqual({ source: 'メッセージ速度', target: '메시지 속도', more: 0 });
  expect(s.count).toBe(1);
});

test('여러 줄: 첫 줄과 나머지 수', () => {
  const s = summarize(record([change('u1', entry('a'), entry('b')), change('u2', entry('c'), entry('d')), change('u3', entry('e'), entry('f'))]), sourceOf);
  expect(s.preview).toMatchObject({ source: 'メッセージ速度', target: 'b', more: 2 });
});

test('번역 지움', () => {
  const s = summarize(record([change('u1', entry('메시지 속도'), entry(null, 'untranslated'))]), sourceOf);
  expect(s.preview).toEqual({ source: 'メッセージ速度', target: null, cleared: true, more: 0 });
});

test('상태만 바뀜', () => {
  const s = summarize(record([change('u1', entry('메시지 속도'), entry('메시지 속도', 'needs-review'))]), sourceOf);
  expect(s.preview).toEqual({ source: 'メッセージ速度', target: '메시지 속도', status: { before: 'translated', after: 'needs-review' }, more: 0 });
});

test('지금은 없는 문장은 원문이 null', () => {
  const s = summarize(record([change('gone', entry(null, 'untranslated'), entry('x'))]), sourceOf);
  expect(s.preview).toMatchObject({ source: null, target: 'x' });
});

test('긴 글과 줄바꿈은 한 줄로 잘린다', () => {
  expect(clipLine('가\n나')).toBe('가 나');
  expect(clipLine('あ'.repeat(50))).toBe(`${'あ'.repeat(40)}…`);
  expect(clipLine('あ'.repeat(40))).toBe('あ'.repeat(40));
  const s = summarize(record([change('u1', entry(null, 'untranslated'), entry(`첫 줄\n${'나'.repeat(60)}`))]), sourceOf);
  expect(s.preview!.target).not.toContain('\n');
  expect([...s.preview!.target!].length).toBe(41);
});

test('원문을 모르면 preview 없이 예전 모양 그대로', () => {
  const s = summarize(record([change('u1', entry('a'), entry('b'))]));
  expect(s).not.toHaveProperty('preview');
});

test('상세: 위치 이름, 전후, 없는 문장, offset/limit', () => {
  const many: ActionChange[] = [change('gone', entry('x'), entry(null, 'untranslated'))];
  for (let i = 0; i < 249; i++) many.push(change('u1', entry(`전${i}`), entry(`후${i}`, 'needs-review')));
  const a = record(many);
  const d = actionDetail(a, (id) => units.get(id));
  expect(d).toMatchObject({ id: 'a1', total: 250, offset: 0 });
  expect(d.lines).toHaveLength(DETAIL_LIMIT);
  expect(d.lines[0]).toEqual({ unitId: 'gone', exists: false, source: null, location: '', before: { target: 'x', status: 'translated' }, after: { target: null, status: 'untranslated' } });
  expect(d.lines[1]).toMatchObject({ unitId: 'u1', exists: true, source: 'メッセージ速度', location: '맵4 · 이벤트3 · 2페이지', before: { target: '전0' }, after: { target: '후0', status: 'needs-review' } });
  const last = actionDetail(a, (id) => units.get(id), 200, 500);
  expect(last).toMatchObject({ total: 250, offset: 200 });
  expect(last.lines).toHaveLength(50);
  expect(actionDetail(a, (id) => units.get(id), -5, 0).lines).toHaveLength(1);
});
