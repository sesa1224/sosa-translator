import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
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
  await svc.setTranslation(idOf('リナ'), '리나', 'user'); expect(await callTool(svc, 'undo_last', {})).toEqual({ ok: true, data: { ids: [] } });
});

// Extra coverage beyond the plan's assertions.
test('도구 목록, 상태, 상태 바꾸기, 쓰기 출처는 chat', async () => {
  expect(TOOL_DEFS.map((t) => t.name).slice(0, 10)).toEqual(['project_status', 'search_units', 'get_unit', 'set_translation', 'set_status', 'undo_last', 'glossary_search', 'glossary_set_term', 'list_decisions', 'set_decision']);
  expect(TOOL_DEFS.map((t) => t.name)).toEqual(['project_status', 'search_units', 'get_unit', 'set_translation', 'set_status', 'undo_last', 'glossary_search', 'glossary_set_term', 'list_decisions', 'set_decision', 'event_files', 'event_list', 'event_read', 'usage_search', 'event_patch', 'image_sheet', 'image_view', 'image_set_recipe', 'image_set_status', 'image_list', 'update_summary']);
  expect(TOOL_DEFS.find((t) => t.name === 'search_units')!.description).toContain('원문, 번역, 화자에서 글자 그대로 찾는다');
  const st = (await callTool(svc, 'project_status', {})) as any;
  expect(st.data).toMatchObject({ name: '약초원', engine: 'MZ', stats: { total: svc.units().length } });
  const seen: string[] = []; svc.on('changed', (e) => seen.push(e.origin));
  const id = idOf('月光草');
  await callTool(svc, 'set_translation', { id, target: '월광초' });
  expect(await callTool(svc, 'set_status', { id, status: 'approved' })).toEqual({ ok: true, data: { status: 'approved' } });
  expect(await callTool(svc, 'set_status', { id, status: 'error' })).toMatchObject({ ok: false });
  expect(seen).toEqual(['chat', 'chat']);
  expect(await callTool(svc, 'undo_last', {})).toEqual({ ok: true, data: { ids: [id] } });
  expect(svc.entry(id).status).toBe('translated');
  const s = (await callTool(svc, 'search_units', { query: 'リナ', status: 'untranslated' })) as any;
  expect(s.data.total).toBeGreaterThan(1);
  expect(s.data.items[0]).toEqual(expect.objectContaining({ id: expect.any(String), location: expect.any(String), needsDecision: false }));
});
