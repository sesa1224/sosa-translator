import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, expect, test } from 'vitest';
import { PreviewService, previewServiceOf } from '../../src/main/preview.js';
import { acceptableRewrap, ProjectService } from '../../src/main/projectService.js';
import { callTool } from '../../src/main/toolHandlers.js';
import { TranslateJob } from '../../src/main/translate/job.js';
import { ReviewJob } from '../../src/main/translate/review.js';
import { buildSystemPrompt } from '../../src/main/claude/prompt.js';
import { computeStats } from '../../src/shared/rows.js';
import type { Issue } from '../../src/core/types.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';
import { makeMiniGame } from '../helpers/miniGame.js';
import { makeTestFont } from '../helpers/testFont.js';
import { idFinder } from './helpers.js';

afterAll(cleanupTempDirs);

const open: ProjectService[] = [];
afterEach(async () => { while (open.length) await open.pop()!.close(); });

type Cmd = { code: number; indent: number; parameters: unknown[] };
const say = (face: string, ...lines: string[]): Cmd[] => [
  { code: 101, indent: 0, parameters: [face, 0, 0, 2, ''] },
  ...lines.map((l) => ({ code: 401, indent: 0, parameters: [l] })),
];

/**
 * MZ mini game with the given dialogue (one event each) and items. Each test Hangul character is 26 px at the
 * MZ font size and a space 6.5 px; the message window is set to 260 px (ten characters) and the help window to
 * 260 px and 2 lines, so short texts overflow.
 */
async function start(o: { dialogue: { face?: string; text: string }[]; items?: { name: string; description: string }[] }) {
  const game = await makeTempDir();
  await makeMiniGame(game);
  const mapFile = path.join(game, 'data', 'Map001.json');
  const map = JSON.parse(await readFile(mapFile, 'utf8'));
  map.events = [null, ...o.dialogue.map((d, i) => ({ id: i + 1, name: `EV${i + 1}`, pages: [{ list: [...say(d.face ?? '', ...d.text.split('\n')), { code: 0, indent: 0, parameters: [] }] }] }))];
  await writeFile(mapFile, JSON.stringify(map), 'utf8');
  if (o.items) await writeFile(path.join(game, 'data', 'Items.json'), JSON.stringify([null, ...o.items.map((it, i) => ({ id: i + 1, note: '', ...it }))]), 'utf8');
  const svc = await ProjectService.create(game, path.join(await makeTempDir(), 'proj'), 'p');
  open.push(svc);
  const preview = new PreviewService(svc);
  await preview.init();
  const glyphs: Record<string, number> = { ' ': 250 };
  for (const ch of '가나다라마바사아자차카타파하') glyphs[ch] = 1000;
  await preview.setFont(await makeTestFont(await makeTempDir(), { name: 'W', glyphs }));
  await preview.setWindow('message', { width: 260 });
  await preview.setWindow('help', { width: 260, maxLines: 2 });
  return { svc, preview, idOf: idFinder(() => svc.units()) };
}

const LONG = '가나다라 마바사아 자차카타 파하';         // 383.5 px
const WRAPPED = '가나다라 마바사아\n자차카타 파하';
const SOLID = '가나다라마바사아자차카타파하';            // no space to break at

test('창별 경고: 대사창과 설명창, 줄 수 넘침', async () => {
  const { svc, idOf } = await start({ dialogue: [{ text: 'ながい' }], items: [{ name: 'くさ', description: 'せつめい' }] });
  expect((await svc.setTranslation(idOf('ながい'), LONG, 'user')).map((i) => i.message)).toEqual(['1번째 줄이 대사창을 124px 넘어요']);
  expect((await svc.setTranslation(idOf('せつめい'), LONG, 'user')).map((i) => i.message)).toEqual(['1번째 줄이 설명창을 124px 넘어요']);
  expect((await svc.setTranslation(idOf('せつめい'), '가\n나\n다', 'user'))).toEqual([{ rule: 'window-lines', severity: 'warning', message: '설명창은 2줄인데 3줄이에요' }]);
  // The item's name is drawn in no measured window: no width warning.
  expect(await svc.setTranslation(idOf('くさ'), LONG, 'user')).toEqual([]);
  expect(svc.hasWindowOverflow(idOf('ながい'))).toBe(true);
  expect(svc.hasWindowOverflow(idOf('くさ'))).toBe(false);
});

test('다시 맞추기: 전체, 행동 하나로 기록, 상태와 검수 기록 유지, 취소하면 원래대로', async () => {
  const { svc, idOf } = await start({ dialogue: [{ text: 'いち' }, { text: 'に' }, { text: 'さん' }], items: [{ name: 'くさ', description: 'せつめい' }] });
  await svc.setTranslation(idOf('いち'), LONG, 'user');
  await svc.setStatus(idOf('いち'), 'approved', 'user');
  await svc.setTranslation(idOf('に'), SOLID, 'user');
  await svc.setTranslation(idOf('さん'), '가나', 'user');
  await svc.setTranslation(idOf('せつめい'), LONG, 'user');
  await svc.setReview(idOf('せつめい'), { problem: 'p', suggestion: 's', model: 'm' }, 'review');
  const before = svc.entry(idOf('いち'));

  expect(svc.planRewrap()).toMatchObject({ fixed: 2, unfixable: 1, byWindow: { message: { fixed: 1, unfixable: 1 }, help: { fixed: 1, unfixable: 0 } }, unfixableIds: [idOf('に')], reasons: { 'no-break': 1 } });
  expect(svc.entry(idOf('いち')).target).toBe(LONG);   // a plan writes nothing

  const r = await svc.rewrapOverflow({}, 'user');
  expect(r).toMatchObject({ fixed: 2, unfixable: 1 });
  expect(svc.entry(idOf('いち'))).toEqual({ ...before, target: WRAPPED });
  expect(svc.entry(idOf('せつめい'))).toMatchObject({ target: WRAPPED, status: 'needs-review', review: { problem: 'p' } });
  expect(svc.entry(idOf('に')).target).toBe(SOLID);
  expect(svc.hasWindowOverflow(idOf('いち'))).toBe(false);

  const log = svc.actions();
  expect(log[0]).toMatchObject({ label: '줄바꿈 다시 맞추기 2줄', origin: 'user' });
  await svc.cancelAction(log[0].id);
  expect(svc.entry(idOf('いち')).target).toBe(LONG);
  expect(svc.entry(idOf('せつめい')).target).toBe(LONG);
});

test('다시 맞추기: 창 종류 하나만, id 목록만', async () => {
  const { svc, idOf } = await start({ dialogue: [{ text: 'いち' }, { text: 'に' }], items: [{ name: 'くさ', description: 'せつめい' }] });
  for (const s of ['いち', 'に', 'せつめい']) await svc.setTranslation(idOf(s), LONG, 'user');
  expect(await svc.rewrapOverflow({ window: 'help' }, 'chat')).toMatchObject({ fixed: 1, byWindow: { message: { fixed: 0 }, help: { fixed: 1 } } });
  expect(svc.entry(idOf('いち')).target).toBe(LONG);
  expect(svc.actions()[0]).toMatchObject({ label: '줄바꿈 다시 맞추기 1줄', origin: 'chat' });
  expect(await svc.rewrapOverflow({ ids: [idOf('に')] }, 'user')).toMatchObject({ fixed: 1 });
  expect(svc.entry(idOf('に')).target).toBe(WRAPPED);
  expect(svc.entry(idOf('いち')).target).toBe(LONG);
});

test('얼굴 그림이 있으면 더 일찍 나누고, 판단 필요·번역 없음·다른 자리에도 쓰인 문장은 건드리지 않는다', async () => {
  const { svc, preview, idOf } = await start({ dialogue: [{ face: 'Actor1', text: 'かお' }], items: [{ name: 'おなじ', description: 'おなじ' }, { name: 'くさ', description: 'せつめい' }] });
  // MZ face indent 164: a window of 260 + 164 leaves ten characters beside the face.
  await preview.setWindow('message', { width: 260 + 164 });
  await svc.setTranslation(idOf('かお'), LONG, 'user');
  await svc.setTranslation(idOf('おなじ'), LONG, 'user');
  const r = await svc.rewrapOverflow({}, 'user');
  expect(svc.entry(idOf('かお')).target).toBe(WRAPPED);
  expect(r).toMatchObject({ fixed: 1, unfixable: 1, reasons: { mixed: 1 } });
  expect(svc.entry(idOf('おなじ')).target).toBe(LONG);
  expect(svc.entry(idOf('せつめい')).target).toBeNull();
});

test('검사가 새 문제를 찾으면 고치지 않는다 (원문과 같은 줄 수 규칙)', async () => {
  const { svc, idOf } = await start({ dialogue: [{ text: 'ながい' }] });
  await svc.setRules({ sameLineCount: true });
  await svc.setTranslation(idOf('ながい'), LONG, 'user');
  expect(await svc.rewrapOverflow({}, 'user')).toMatchObject({ fixed: 0, unfixable: 1, reasons: { check: 1 } });
  expect(svc.entry(idOf('ながい')).target).toBe(LONG);
});

test('acceptableRewrap: 규칙·심각도별로 새 문제가 없고 창 넘침이 없을 때만', () => {
  const w = (rule: Issue['rule'], severity: Issue['severity'] = 'warning'): Issue => ({ rule, severity, message: '' });
  expect(acceptableRewrap([w('line-width-px'), w('glossary')], [w('glossary')])).toBe(true);
  expect(acceptableRewrap([w('line-width-px')], [w('line-count', 'error')])).toBe(false);
  expect(acceptableRewrap([w('line-width-px')], [w('window-lines')])).toBe(false);
  expect(acceptableRewrap([w('glossary'), w('line-width-px')], [w('glossary'), w('glossary')])).toBe(false);
});

test('자동 적용: 켜져 있으면 채팅·가져오기의 번역을 나누고, 끄면 그대로, 직접 친 번역은 안 건드림', async () => {
  const { svc, idOf } = await start({ dialogue: [{ text: 'いち' }, { text: 'に' }, { text: 'さん' }] });
  expect(svc.glossary().rules.autoRewrap).toBe(true);
  const r = (await callTool(svc, 'set_translation', { id: idOf('いち'), target: LONG })) as { ok: true; data: { rewrapped?: string } };
  expect(r.data.rewrapped).toBe(WRAPPED);
  expect(svc.entry(idOf('いち')).target).toBe(WRAPPED);
  await svc.applyImport({ ok: [{ id: idOf('に'), target: LONG, issues: [] }], conflicts: [], unknownIds: [], invalid: 0 }, false);
  expect(svc.entry(idOf('に')).target).toBe(WRAPPED);
  await svc.setTranslation(idOf('さん'), LONG, 'user');
  expect(svc.entry(idOf('さん')).target).toBe(LONG);

  await svc.setRules({ autoRewrap: false });
  expect(svc.autoWrap(idOf('さん'), LONG)).toBe(LONG);
  await callTool(svc, 'set_translation', { id: idOf('いち'), target: LONG });
  expect(svc.entry(idOf('いち')).target).toBe(LONG);
});

test('자동 적용: 번역 작업과 검수 제안도 같은 자리에서 나눈다', async () => {
  const { svc, idOf } = await start({ dialogue: [{ text: 'いち' }] });
  const id = idOf('いち');
  const reply = (body: unknown) => async () => ({ ok: true as const, data: body, usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 } });
  const tj = new TranslateJob({ svc, call: (async (o: { user: string }) => reply({ items: JSON.parse(o.user).items.map((x: { i: number }) => ({ i: x.i, t: LONG })) })()) as any, claude: { command: 'claude' }, model: 'm', cwd: '.', ids: [id] });
  await tj.start();
  expect(svc.entry(id).target).toBe(WRAPPED);
  const rj = new ReviewJob({ svc, call: (async (o: { user: string }) => reply({ problems: JSON.parse(o.user).items.map((x: { i: number }) => ({ i: x.i, problem: '어색함', suggestion: `${LONG} 가` })) })()) as any, claude: { command: 'claude' }, model: 'm', cwd: '.', scope: { scope: 'all' } });
  await rj.start();
  expect(svc.entry(id).review?.suggestion).toBe('가나다라 마바사아\n자차카타 파하 가');
});

test('채팅 도구: set_text_window 는 한글 글자 수·맞는 글·px 로 기준을 정하고, rewrap_overflow 는 한 번에 고친다', async () => {
  const { svc, preview, idOf } = await start({ dialogue: [{ text: 'いち' }, { text: 'に' }] });
  await svc.setRules({ autoRewrap: false });
  await svc.setTranslation(idOf('いち'), LONG, 'user');
  await svc.setTranslation(idOf('に'), SOLID, 'user');
  expect(previewServiceOf(svc)).toBe(preview);

  const set = (await callTool(svc, 'set_text_window', { window: 'message', chars: 12 })) as { ok: true; data: Record<string, unknown> };
  expect(set.data).toMatchObject({ window: 'message', width: 312, widthWithFace: 312 - 164, maxLines: 4, hangulChars: 12, overflowing: 2, canRewrap: 1 });
  expect(preview.limits().message.width).toBe(312);
  expect(((await callTool(svc, 'set_text_window', { window: 'help', fits: '가나다 라마', maxLines: 3 })) as { ok: true; data: Record<string, unknown> }).data)
    .toMatchObject({ window: 'help', width: 137, maxLines: 3, hangulChars: 5 });
  expect(((await callTool(svc, 'set_text_window', { window: 'message', px: 200, withFace: true })) as { ok: true; data: Record<string, unknown> }).data)
    .toMatchObject({ width: 364, widthWithFace: 200 });
  expect(await callTool(svc, 'set_text_window', { window: 'message', chars: 10, px: 3 })).toMatchObject({ ok: false });

  await preview.setWindow('message', { width: 260 });
  const found = (await callTool(svc, 'search_units', { query: '', status: 'overflow' })) as { ok: true; data: { total: number } };
  expect(found.data.total).toBe(2);
  const fixed = (await callTool(svc, 'rewrap_overflow', {})) as { ok: true; data: unknown };
  expect(fixed.data).toEqual({ fixed: 1, unfixable: 1, unfixableIds: [idOf('に')], reasons: { 'no-break': 1 } });
  expect(svc.entry(idOf('いち')).target).toBe(WRAPPED);
  expect(svc.actions()[0].origin).toBe('chat');
  expect(buildSystemPrompt(svc.meta, computeStats([]))).toContain('set_text_window 로 기준을 정한 뒤 rewrap_overflow 를 한 번 부른다');
});

test('게임 폰트가 없으면 다시 맞추기와 기준 정하기는 폰트를 고르라고 한다', async () => {
  const { svc, preview } = await start({ dialogue: [{ text: 'ながい' }] });
  await preview.setFont(null);
  await expect(svc.rewrapOverflow({}, 'user')).rejects.toThrow('게임 폰트를 먼저 고르세요');
  expect(await callTool(svc, 'rewrap_overflow', {})).toMatchObject({ ok: false, error: expect.stringContaining('게임 폰트') });
  expect(await callTool(svc, 'set_text_window', { window: 'message', chars: 10 })).toMatchObject({ ok: false });
});

test('창별 기준을 지우면 감지한 값으로 돌아가고 preview.json 에 남는다', async () => {
  const { svc, preview } = await start({ dialogue: [{ text: 'ながい' }] });
  expect(JSON.parse(await readFile(path.join(svc.projectDir, 'preview.json'), 'utf8')).windows).toEqual({ message: { width: 260 }, help: { width: 260, maxLines: 2 } });
  await preview.setWindow('message', { width: null });
  expect(preview.limits().message.width).toBe(768);
  expect(preview.windows().message).toMatchObject({ detected: { width: 768, maxLines: 4 }, override: {}, hangulWidth: 26, faceIndent: 164 });
  await expect(preview.setWindow('message', { width: -3 })).rejects.toThrow();
});
