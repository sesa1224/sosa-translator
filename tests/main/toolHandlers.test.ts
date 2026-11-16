import { afterAll, afterEach, beforeEach, describe, expect, test } from 'vitest';
import { clipLine } from '../../src/core/history/store.js';
import { ProjectService } from '../../src/main/projectService.js';
import { callTool, TOOL_DEFS } from '../../src/main/toolHandlers.js';
import { cleanupTempDirs } from '../helpers/fs.js';
import { freshGame, idFinder } from './helpers.js';

let svc: ProjectService;
const idOf = idFinder(() => svc.units());

beforeEach(async () => {
  const { game, proj } = await freshGame();
  svc = await ProjectService.create(game, proj, '약초원');
});
afterEach(async () => { await svc.close(); });
afterAll(async () => { await cleanupTempDirs(); });

test('검색하고 번역을 쓴다', async () => {
  const r = await callTool(svc, 'search_units', { query: '月光草' }); expect(r.ok).toBe(true);
  const id = (r as any).data.items[0].id;
  expect(await callTool(svc, 'set_translation', { id, target: '월광초' })).toEqual({ ok: true, data: { status: 'translated', issues: [] } });
  expect(svc.entry(id).target).toBe('월광초');
});
test('limit 은 50을 넘지 않는다', async () => { expect(((await callTool(svc, 'search_units', { query: '', limit: 999 })) as any).data.items.length).toBeLessThanOrEqual(50); });
test('get_unit 은 앞뒤 문맥을 준다', async () => {
  const d = ((await callTool(svc, 'get_unit', { id: idOf('やった！') })) as any).data;
  expect(d.before.map((x: any) => x.source)).toContain('あれ？\\N[1]じゃない！\nこんな夜に来るなんて'); expect(d.refCount).toBe(1);
});
test('잘못된 입력과 모르는 도구', async () => {
  expect(await callTool(svc, 'set_translation', { id: 1 })).toMatchObject({ ok: false });
  expect(await callTool(svc, 'rm_rf', {})).toEqual({ ok: false, error: '모르는 도구입니다: rm_rf' });
  expect(await callTool(svc, 'get_unit', { id: 'nope' })).toEqual({ ok: false, error: '없는 항목입니다: nope' });
});
test('되돌리기는 채팅 변경만', async () => {
  await svc.setTranslation(idOf('リナ'), '리나', 'user');
  expect(await callTool(svc, 'undo_last', {})).toEqual({ ok: true, data: { undone: false, reason: '되돌릴 채팅 변경이 없습니다' } });
  expect(svc.entry(idOf('リナ')).target).toBe('리나');
});

// Extra coverage beyond the plan's assertions.
test('도구 목록, 상태, 상태 바꾸기, 쓰기 출처는 chat', async () => {
  expect(TOOL_DEFS.map((t) => t.name).slice(0, 10)).toEqual(['project_status', 'search_units', 'get_unit', 'set_translation', 'set_status', 'undo_last', 'glossary_search', 'glossary_set_term', 'list_decisions', 'set_decision']);
  expect(TOOL_DEFS.map((t) => t.name)).toEqual(['project_status', 'search_units', 'get_unit', 'set_translation', 'set_status', 'undo_last', 'glossary_search', 'glossary_set_term', 'list_decisions', 'set_decision', 'list_actions', 'cancel_action', 'event_files', 'event_list', 'event_read', 'usage_search', 'event_patch', 'image_sheet', 'image_view', 'image_set_recipe', 'image_set_status', 'image_list', 'set_josa_plugin', 'find_game_text', 'add_extract_text', 'update_summary', 'set_text_window', 'rewrap_overflow']);
  expect(TOOL_DEFS.find((t) => t.name === 'search_units')!.description).toContain('원문, 번역, 화자에서 글자 그대로 찾는다');
  const st = (await callTool(svc, 'project_status', {})) as any;
  expect(st.data).toMatchObject({ name: '약초원', engine: 'MZ', stats: { total: svc.units().length } });
  const seen: string[] = []; svc.on('changed', (e) => seen.push(e.origin));
  const id = idOf('月光草');
  await callTool(svc, 'set_translation', { id, target: '월광초' });
  expect(await callTool(svc, 'set_status', { id, status: 'approved' })).toEqual({ ok: true, data: { status: 'approved' } });
  expect(await callTool(svc, 'set_status', { id, status: 'error' })).toMatchObject({ ok: false });
  expect(seen).toEqual(['chat', 'chat']);
  // Outside a turn each write is an action of its own: undo_last takes back the newest one (the status).
  expect(await callTool(svc, 'undo_last', {})).toMatchObject({ ok: true, data: { undone: true, action: { label: '상태 바꿈' }, restored: 1, skipped: 0 } });
  expect(svc.entry(id).status).toBe('translated');
  const s = (await callTool(svc, 'search_units', { query: 'リナ', status: 'untranslated' })) as any;
  expect(s.data.total).toBeGreaterThan(1);
  expect(s.data.items[0]).toEqual(expect.objectContaining({ id: expect.any(String), location: expect.any(String), needsDecision: false }));
});

describe('되돌리기와 작업 기록 도구', () => {
  const turn = () => svc.beginAction('chat', (k) => `채팅에서 바꿈 ${k}개`);
  const plain = () => svc.units().filter((u) => !u.needsDecision);

  test('이번 턴에 고친 것이 있으면 그것을 전부 되돌리고, 턴이 끝나도 행동이 남지 않는다', async () => {
    const [a, b] = plain();
    await turn();
    await callTool(svc, 'set_translation', { id: a.id, target: '하나' });
    await callTool(svc, 'set_translation', { id: b.id, target: '둘' });
    const r = (await callTool(svc, 'undo_last', {})) as any;
    expect(r.data).toMatchObject({ undone: true, action: { label: '이번 턴에 채팅에서 바꾼 것', origin: 'chat' }, restored: 2, skipped: 0, more: 0 });
    expect(r.data.lines).toEqual([
      { location: expect.any(String), source: clipLine(a.source, 30) },
      expect.objectContaining({ location: expect.any(String) }),
    ]);
    expect(svc.entry(a.id).target).toBeNull();
    expect(svc.entry(b.id).target).toBeNull();
    await svc.endAction('chat');
    expect(svc.actions()).toHaveLength(0);
  });

  test('이번 턴에 고친 것이 없으면 채팅의 직전 행동을 통째로 취소하고, 사용자와 다른 출처의 행동은 건드리지 않는다', async () => {
    const [a, b, c, d] = plain();
    await turn();
    await callTool(svc, 'set_translation', { id: a.id, target: '하나' });
    await callTool(svc, 'set_translation', { id: b.id, target: '둘' });
    await svc.endAction('chat');
    await svc.setTranslation(c.id, '사용자', 'user');
    await svc.beginAction('batch', (k) => `전체 번역 ${k}개`);
    await svc.setTranslation(d.id, '작업', 'batch');
    await svc.endAction('batch');
    await svc.setTranslation(b.id, '사용자가 고침', 'user');
    await turn();
    const r = (await callTool(svc, 'undo_last', {})) as any;
    expect(r.data).toMatchObject({ undone: true, action: { id: expect.any(String), label: '채팅에서 바꿈 2개', at: expect.any(String), origin: 'chat' }, restored: 1, skipped: 1 });
    expect(svc.entry(a.id).target).toBeNull();
    expect(svc.entry(b.id).target).toBe('사용자가 고침');
    expect(svc.entry(c.id).target).toBe('사용자');
    expect(svc.entry(d.id).target).toBe('작업');
    expect(svc.actions().filter((x) => x.undoneAt).map((x) => x.label)).toEqual(['채팅에서 바꿈 2개']);
    // Nothing of the chat is left to take back.
    expect(((await callTool(svc, 'undo_last', {})) as any).data).toEqual({ undone: false, reason: '되돌릴 채팅 변경이 없습니다' });
  });

  test('재현: 한 턴에 12개를 넣고 다음 턴에 undo_last 한 번이면 12개가 한 행동으로 돌아가고 기록에 남는다', async () => {
    const units = plain().slice(0, 12);
    expect(units).toHaveLength(12);
    await turn();
    for (const [i, u] of units.entries()) await callTool(svc, 'set_translation', { id: u.id, target: `번역${i}` });
    await svc.endAction('chat');
    await turn();
    const r = (await callTool(svc, 'undo_last', {})) as any;
    await svc.endAction('chat');
    expect(r.data).toMatchObject({ undone: true, action: { label: '채팅에서 바꿈 12개' }, restored: 12, skipped: 0, more: 7 });
    expect(r.data.lines).toHaveLength(5);
    for (const l of r.data.lines) expect([...l.source].length).toBeLessThanOrEqual(31);
    for (const u of units) expect(svc.entry(u.id).target).toBeNull();
    const [act] = svc.actions();
    expect(act).toMatchObject({ label: '채팅에서 바꿈 12개', count: 12, undoneAt: expect.any(String) });
    expect(svc.actions()).toHaveLength(1);
  });

  test('list_actions 는 최근 10개, cancel_action 은 출처가 달라도 그 행동만 취소한다', async () => {
    const [a, b] = plain();
    for (let i = 0; i < 11; i++) await svc.setTranslation(a.id, `번역${i}`, 'user');
    await svc.setTranslation(b.id, '채팅', 'chat');
    const list = ((await callTool(svc, 'list_actions', {})) as any).data;
    expect(list.total).toBe(12);
    expect(list.actions).toHaveLength(10);
    expect(list.actions[0]).toEqual({ id: expect.any(String), at: expect.any(String), origin: 'chat', label: '번역 고침', count: 1, undone: false });
    const userAct = list.actions[1];
    expect(userAct.origin).toBe('user');
    const r = (await callTool(svc, 'cancel_action', { id: userAct.id })) as any;
    expect(r.data).toMatchObject({ undone: true, action: { id: userAct.id, origin: 'user' }, restored: 1, skipped: 0, more: 0 });
    expect(r.data.lines).toEqual([{ location: expect.any(String), source: expect.any(String) }]);
    expect(svc.entry(a.id).target).toBe('번역9');
    expect(svc.entry(b.id).target).toBe('채팅');
    expect(((await callTool(svc, 'list_actions', {})) as any).data.actions[1].undone).toBe(true);
    expect(await callTool(svc, 'cancel_action', { id: userAct.id })).toEqual({ ok: false, error: '이미 취소한 행동입니다' });
    expect(await callTool(svc, 'cancel_action', { id: 'nope' })).toEqual({ ok: false, error: '없는 행동입니다: nope' });
  });
});
