import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeEach, afterEach, expect, test } from 'vitest';
import { termId } from '../../src/core/glossary/store.js';
import type { JsonCallResult } from '../../src/main/claude/json.js';
import { registerIpc, type IpcDeps } from '../../src/main/ipc.js';
import { ProjectService } from '../../src/main/projectService.js';
import { loadSettings, saveSettings } from '../../src/main/settings.js';
import { callTool } from '../../src/main/toolHandlers.js';
import type { JobProgress } from '../../src/shared/api.js';
import { toRow } from '../../src/shared/rows.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';
import { makeMiniGame } from '../helpers/miniGame.js';
import { freshGame, idFinder } from './helpers.js';
import { okAll, someUsage } from './jobHelpers.js';

afterAll(() => cleanupTempDirs());

// ---- ProjectService ----------------------------------------------------------------------------
let svc: ProjectService;
const idOf = idFinder(() => svc.units());
const rowOf = (id: string) => toRow(svc.unit(id)!, svc.entry(id), svc.usesProvisional(id));
let profileId = '';

// ---- IPC with a fake JSON call -----------------------------------------------------------------
const handlers = new Map<string, (e: unknown, ...a: any[]) => any>();
const broadcasts: { channel: string; payload: any }[] = [];
const invoke = async (channel: string, ...args: any[]): Promise<any> => handlers.get(channel)!({}, ...args);
const sent = (channel: string) => broadcasts.filter(b => b.channel === channel).map(b => b.payload);
const fakeCall = Object.assign(
  async (o: { model: string; user: string; schema: any }): Promise<JsonCallResult<any>> => {
    fakeCall.models.push(o.model);
    await new Promise(r => setTimeout(r, 20));
    const keys = Object.keys(o.schema.properties);
    if (keys.includes('styleNotes')) {
      return { ok: true, usage: someUsage, data: { terms: [{ source: 'リナ', category: 'name', candidates: [{ target: '리나', reason: '' }] }], characters: [], styleNotes: '밝은 분위기' } };
    }
    if (keys.includes('problems')) return { ok: true, usage: someUsage, data: { problems: [] } };
    if (keys.includes('style')) return { ok: true, usage: someUsage, data: { characters: [], terms: [], sfx: [], style: '' } };   // script reading
    return okAll(o);
  },
  { models: [] as string[] },
);
let disposeIpc: (() => Promise<void>) | null = null;
const idleJob = () => new Promise<void>((resolve) => {
  const check = async () => {
    const p: JobProgress | null = await invoke('job:current');
    if (!p || !['running'].includes(p.state)) resolve(); else setTimeout(check, 20);
  };
  void check();
});

beforeEach(async () => {
  const { game, proj } = await freshGame();
  // The actor profile mentions the actor: 'リナは薬草園の見習い'.
  const actors = path.join(game, 'data', 'Actors.json');
  const list = JSON.parse(await readFile(actors, 'utf8')); list[1].profile = 'リナは薬草園の見習い';
  await writeFile(actors, JSON.stringify(list), 'utf8');
  svc = await ProjectService.create(game, proj, '약초원');
  profileId = idOf('リナは薬草園の見習い');

  handlers.clear(); broadcasts.length = 0; fakeCall.models.length = 0;
  const ipcGame = await makeTempDir(); await makeMiniGame(ipcGame);
  const settingsDir = await makeTempDir();
  await saveSettings(settingsDir, { ...(await loadSettings(settingsDir)), projectsDir: await makeTempDir() });
  const deps: IpcDeps = {
    ipcMain: { handle: (channel, fn) => { handlers.set(channel, fn); } },
    pickDirectory: async () => ipcGame, settingsDir, holder: { svc: null },
    broadcast: (channel, payload) => { broadcasts.push({ channel, payload }); },
    createChat: () => null, claudePath: () => 'C:/fake/claude.exe', showItemInFolder: () => {},
    runJson: fakeCall as any,
  };
  disposeIpc = registerIpc(deps).dispose;
  await invoke('project:create', ipcGame, '약초원');
});
afterEach(async () => { await idleJob(); await disposeIpc?.(); await svc.close(); });

test('후보를 고르면 번역문이 따라 바뀐다', async () => {
  await svc.upsertTerm({ source: 'リナ', target: '리나', category: 'name', status: 'provisional', candidates: [{ target: '리나', reason: '' }, { target: '린', reason: '' }] });
  await svc.setTranslation(profileId, '리나는 약초원의 견습생', 'user'); expect(rowOf(profileId).usesProvisional).toBe(true);
  const r = await svc.chooseCandidate(termId('リナ'), '린'); expect(r.changed).toContain(profileId);
  expect(svc.entry(profileId).target).toBe('린은 약초원의 견습생'); expect(svc.glossary().terms[0]).toMatchObject({ target: '린', status: 'confirmed' }); expect(rowOf(profileId).usesProvisional).toBe(false);
});
test('확정 전에는 전체 번역을 시작할 수 없다', async () => {
  await expect(invoke('job:translate')).rejects.toThrow('용어집을 먼저 확정하세요'); await invoke('glossary:confirm');
  await invoke('job:translate'); await expect(invoke('job:review', { scope: 'all' })).rejects.toThrow('다른 작업이 진행 중입니다');
});
test('단계별 모델이 쓰인다', async () => {
  await invoke('settings:set', { stageModels: { glossary: 'g', translate: 't', review: 'r', patchNotes: 'p' } });
  await invoke('job:draft'); expect(fakeCall.models.at(-1)).toBe('g'); await invoke('glossary:confirm'); await invoke('job:translate'); await idleJob(); expect(fakeCall.models.at(-1)).toBe('t');
});
test('초안은 용어집에 합쳐지고 알림이 간다', async () => { await invoke('job:draft'); expect(sent('glossary:changed').at(-1).terms.length).toBeGreaterThan(0); });
test('채팅 도구로 용어를 정한다', async () => {
  expect(await callTool(svc, 'glossary_set_term', { source: '月光草', target: '월광초' })).toMatchObject({ ok: true });
  expect(((await callTool(svc, 'glossary_search', { query: '月光' })) as any).data.terms[0].target).toBe('월광초');
});

// Extra coverage beyond the plan's assertions.
test('용어를 바꾸면 조사를 맞추고, 못 맞추면 검토로 올린다', async () => {
  await callTool(svc, 'glossary_set_term', { source: 'リナ', target: '리나', category: 'name' });
  await svc.setTranslation(profileId, '리나는 약초원의 견습생', 'user'); await svc.setStatus(profileId, 'approved', 'user');
  const other = idOf('月光草'); await svc.setTranslation(other, '리나이야기', 'user');   // 원문에 リナ 가 없으니 그대로
  const r: any = await callTool(svc, 'glossary_set_term', { source: 'リナ', target: '린' });
  expect(r.data).toMatchObject({ changed: [profileId], uncertain: [] });
  expect(svc.entry(profileId)).toMatchObject({ target: '린은 약초원의 견습생', status: 'approved' });
  expect(svc.entry(other).target).toBe('리나이야기');
  await svc.removeTerm(termId('リナ')); expect(svc.glossary().terms).toEqual([]);
});
test('검수 범위 추정, 검수 받기와 거절, 용어집 조작 IPC', async () => {
  const snap = await invoke('project:snapshot');
  const id = snap.rows.find((r: any) => r.source === '月光草').id;
  await invoke('unit:setTranslation', id, '월광초');
  expect(await invoke('job:reviewPlan', { scope: 'all' })).toMatchObject({ items: 1, model: 'claude-fable-5-2' });
  await invoke('glossary:upsertTerm', { source: '月光草', target: '월광초', category: 'term', status: 'provisional', candidates: [{ target: '월광초', reason: '' }, { target: '달빛풀', reason: '' }] });
  expect(sent('project:changed').at(-1).rows[0]).toMatchObject({ id, usesProvisional: true });
  expect(sent('project:changed').at(-1).stats.provisional).toBe(1);
  expect(await invoke('glossary:choose', termId('月光草'), '달빛풀')).toEqual({ changed: [id], uncertain: [] });
  expect((await invoke('unit:get', id)).row).toMatchObject({ target: '달빛풀', usesProvisional: false });
  await invoke('glossary:setRules', { maxLineWidthChars: 20 }); expect((await invoke('glossary:get')).rules.maxLineWidthChars).toBe(20);
  await invoke('glossary:setStyleGuide', '짧은 지침'); expect((await invoke('glossary:get')).styleGuide).toBe('짧은 지침');
  expect(await invoke('glossary:defaultStyleGuide')).toContain('의성어');
  await invoke('glossary:setCharacters', [{ id: '', source: 'リナ', target: '리나', speech: '반말' }]);
  expect((await invoke('glossary:get')).characters[0].id).toBe(termId('リナ'));
  expect(await invoke('glossary:detectSpeakerPattern')).toBeNull();
  await invoke('job:review', { scope: 'all' }); await idleJob();
  expect(sent('job:progress').at(-1)).toMatchObject({ kind: 'review', state: 'done', done: 1 });
});
test('초안 계획과 단계별 모델: 대본 읽기 칸이 비면 정리 모델과 같다', async () => {
  const plan = await invoke('job:draftPlan', 'balanced');
  expect(plan).toMatchObject({ model: 'claude-fable-5-2', readModel: 'claude-fable-5-2' });
  expect(plan.chunks).toBeGreaterThan(0); expect(plan.estimatedInputTokens).toBeGreaterThan(0);
  expect((await invoke('job:draftPlan', 'sample')).chunks).toBe(0);
  await invoke('settings:set', { stageModels: { glossary: 'g', translate: 't', review: 'r', patchNotes: 'p' } });
  await invoke('job:draft', 'full'); expect(new Set(fakeCall.models)).toEqual(new Set(['g']));
  fakeCall.models.length = 0;
  await invoke('settings:set', { stageModels: { glossary: 'g', glossaryRead: 'gr', translate: 't', review: 'r', patchNotes: 'p' } });
  await invoke('job:draft', 'full', {}); expect(fakeCall.models).toEqual(['g']);   // 같은 대본: 읽은 메모를 다시 쓰고 정리만 한다
  await invoke('job:draft', 'balanced', { readModel: 'x-read', mergeModel: 'x-merge', budgetChars: 20000 });
  expect(fakeCall.models.at(-1)).toBe('x-merge');
  expect((await invoke('job:draftPlan', 'balanced', { readModel: 'x-read' })).readModel).toBe('x-read');
  expect((await invoke('job:draftPlan', 'balanced')).readModel).toBe('gr');
});
