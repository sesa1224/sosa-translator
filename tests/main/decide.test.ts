import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { saveDecisions } from '../../src/core/decisions/store.js';
import type { Decision } from '../../src/core/decisions/types.js';
import { NEED_LOGIN } from '../../src/main/claude/chat.js';
import { ProjectService } from '../../src/main/projectService.js';
import { buildDecidePrompt, DecideJob, DECIDE_SCHEMA } from '../../src/main/translate/decide.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';
import { makeMiniGame } from '../helpers/miniGame.js';
import { someUsage, zero, type FakeCall } from './jobHelpers.js';

const MENU_JS = '/*:\n * @param title\n * @type file\n */\nvar a = "記録を見る";\nvar b = \'しおり\';\n';

let svc: ProjectService;
let proj: string;

async function makeGame(): Promise<string> {
  const game = await makeTempDir();
  await makeMiniGame(game);
  await mkdir(path.join(game, 'js/plugins'), { recursive: true });
  await writeFile(path.join(game, 'js/plugins/Menu.js'), MENU_JS);
  return game;
}

beforeEach(async () => {
  const game = await makeGame();
  proj = path.join(await makeTempDir(), 'proj');
  svc = await ProjectService.create(game, proj, '약초원');
});
afterEach(async () => { await svc.close(); });
afterAll(cleanupTempDirs);

type Seen = { system: string; user: any; model: string };
function fake(seen: Seen[], answerFor: (key: string) => object | null, extra: object[] = []): FakeCall {
  return async (o: any) => {
    const user = JSON.parse(o.user);
    seen.push({ system: o.system, user, model: o.model });
    const decisions = user.groups.map((g: any) => answerFor(g.key)).filter(Boolean);
    return { ok: true, data: { decisions: [...decisions, ...extra] }, usage: { ...someUsage } };
  };
}
const mk = (call: FakeCall) => new DecideJob({ svc, call: call as any, claude: { command: 'claude' }, model: 'claude-fable-5-2', cwd: '.' });
const sentKeys = (seen: Seen[]) => seen.flatMap((s) => s.user.groups.map((g: any) => g.key));

test('자동 결정은 호출 없이, 나머지는 Claude 추천으로 저장', async () => {
  const seen: Seen[] = [];
  const job = mk(fake(seen, (key) => (key === 'mv:ShowRecord'
    ? { key, translate: true, mode: 'args', reason: '메뉴에 보이는 글자' }
    : { key, translate: false, mode: 'whole', reason: '코드 값' }), [{ key: 'mv:Unknown', translate: true, mode: 'whole', reason: 'x' }]));
  await job.start();
  expect(job.progress).toMatchObject({ kind: 'decide', state: 'done', errors: 0 });
  const d = svc.decisions();
  expect(d['param:Menu:title']).toMatchObject({ translate: false, status: 'suggested', by: 'meta' });
  expect(sentKeys(seen)).not.toContain('param:Menu:title');
  expect(d['mv:ShowRecord']).toEqual({ translate: true, keep: { mode: 'args', from: 1, dropLast: 0 }, status: 'suggested', by: 'claude', reason: '메뉴에 보이는 글자' });
  expect(d['param:Menu:list[*].label']).toMatchObject({ translate: false, status: 'suggested', by: 'claude' });
  expect(d).not.toHaveProperty('mv:Unknown');
  expect(seen[0].system).toContain('확신이 없으면 translate false 로 하고');
  expect(seen[0].model).toBe('claude-fable-5-2');
});

test('JS 파일의 문자열은 unit:<id> 로 하나씩, 앞뒤 문맥과 함께', async () => {
  const seen: Seen[] = [];
  await mk(fake(seen, (key) => ({ key, translate: key.startsWith('unit:'), mode: 'whole', reason: 'r' }))).start();
  const js = svc.units().filter((u) => u.kind === 'plugin-js');
  expect(js).toHaveLength(2);
  const jsCall = seen.find((s) => s.user.groups.some((g: any) => g.key.startsWith('unit:')))!;
  expect(jsCall.user.groups.map((g: any) => g.key).sort()).toEqual(js.map((u) => `unit:${u.id}`).sort());
  const first = jsCall.user.groups.find((g: any) => g.samples[0] === '記録を見る');
  expect(first.context.before).toContain('var a = ');
  expect(first.context.after).toContain("var b = 'しおり'");
  expect(sentKeys(seen)).not.toContain('js:Menu.js');
  for (const u of js) expect(svc.decisions()[`unit:${u.id}`]).toMatchObject({ translate: true, by: 'claude', status: 'suggested' });
});

test('확정된 결정은 보내지도 바꾸지도 않는다', async () => {
  await svc.close();
  const confirmed: Decision = { translate: true, keep: { mode: 'args', from: 1, dropLast: 0 }, status: 'confirmed', by: 'user' };
  await saveDecisions(proj, { 'mv:ShowRecord': confirmed, 'param:Menu:title': { ...confirmed, keep: { mode: 'whole' } } });
  svc = await ProjectService.open(proj);
  const seen: Seen[] = [];
  await mk(fake(seen, (key) => ({ key, translate: false, mode: 'whole', reason: 'r' }), [{ key: 'mv:ShowRecord', translate: false, mode: 'whole', reason: 'x' }])).start();
  expect(sentKeys(seen)).not.toContain('mv:ShowRecord');
  expect(svc.decisions()['mv:ShowRecord']).toEqual(confirmed);
  expect(svc.decisions()['param:Menu:title'].status).toBe('confirmed');
});

test('auth 는 실패와 로그인 안내, limit 는 paused-limit, 거절은 그 묶음만 건너뛴다', async () => {
  const auth = mk(async () => ({ ok: false, kind: 'auth', message: 'x', usage: { ...zero } }));
  await auth.start();
  expect(auth.progress).toMatchObject({ state: 'failed', message: NEED_LOGIN });
  const limit = mk(async () => ({ ok: false, kind: 'limit', message: 'limit', usage: { ...zero } }));
  await limit.start();
  expect(limit.progress.state).toBe('paused-limit');
  const refused = mk(async () => ({ ok: false, kind: 'refused', message: 'no', usage: { ...zero } }));
  await refused.start();
  expect(refused.progress.state).toBe('done');
  expect(refused.progress.errors).toBeGreaterThan(0);
});

test('프롬프트와 스키마', () => {
  const p = buildDecidePrompt([{ key: 'mv:addLog', label: 'addLog', kind: 'plugin-command', count: 3, samples: ['addLog あ'], hints: { fileNames: 0 }, decision: null }]);
  expect(JSON.parse(p.user)).toEqual({ groups: [{ key: 'mv:addLog', label: 'addLog', kind: 'plugin-command', count: 3, samples: ['addLog あ'], hints: { fileNames: 0 } }] });
  expect(p.system).toContain('화면에 보이는 글자인지 코드가 읽는 값인지 판단한다');
  expect(DECIDE_SCHEMA.properties.decisions.items.properties.mode.enum).toEqual(['whole', 'args', 'spans']);
});
