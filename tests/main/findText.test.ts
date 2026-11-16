import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, expect, test } from 'vitest';
import { EXTRACT_FILE, EXTRACTOR_VERSION } from '../../src/core/extract/settings.js';
import { buildSystemPrompt } from '../../src/main/claude/prompt.js';
import { ProjectService } from '../../src/main/projectService.js';
import { callTool } from '../../src/main/toolHandlers.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';
import { makeMiniGame } from '../helpers/miniGame.js';

let svc: ProjectService | null = null;
afterEach(async () => { await svc?.close(); svc = null; });
afterAll(cleanupTempDirs);

async function open(): Promise<ProjectService> {
  const game = await makeTempDir();
  await makeMiniGame(game, { keys: true });
  svc = await ProjectService.create(game, path.join(await makeTempDir(), 'proj'), '약초원');
  return svc;
}
const data = (r: unknown) => (r as { ok: true; data: any }).data;

test('find_game_text: 설정 값, 열쇠 이름, 플러그인 JS, data 파일, 없음', async () => {
  const s = await open();
  const std = data(await callTool(s, 'find_game_text', { text: '標準' }));
  expect(std.places).toEqual([
    { where: '플러그인 설정의 열쇠 이름', plugin: 'Speed', setting: 'Speed List', unit: { id: expect.any(String), status: 'untranslated', target: null } },
    { where: '플러그인 설정 값', plugin: 'Speed', setting: 'Default Label', unit: { id: expect.any(String), status: 'untranslated', target: null } },
  ]);
  expect(std.places[0].unit.id).not.toBe(std.places[1].unit.id);

  const fps = data(await callTool(s, 'find_game_text', { text: 'Monitor FPS Sync' }));
  // The header comment's @default is not code: only the literal in code counts.
  expect(fps.places).toEqual([
    { where: '플러그인 설정 값', plugin: 'Fps', setting: 'Command Name', unit: null },
    { where: '플러그인 JS 문자열', file: 'js/plugins/Fps.js', count: 1, unit: null },
  ]);

  const item = data(await callTool(s, 'find_game_text', { text: '月光草' }));
  expect(item.places).toEqual([{ where: 'data 파일', file: 'data/Items.json', count: 1, unit: { id: expect.any(String), status: 'untranslated', target: null } }]);

  expect(data(await callTool(s, 'find_game_text', { text: '없는 글자' }))).toEqual({ total: 0, places: [] });
  expect(await callTool(s, 'find_game_text', { text: '' })).toMatchObject({ ok: false });
});

test('add_extract_text: 플러그인 설정에 있으면 넣고 다시 추출한다, 기존 번역은 남는다', async () => {
  const s = await open();
  const item = s.units().find((u) => u.source === '月光草')!;
  await s.setTranslation(item.id, '월광초', 'user');
  const before = s.units().map((u) => u.id);
  let pushed = 0;
  s.on('units-changed', () => pushed++);

  const r = data(await callTool(s, 'add_extract_text', { text: 'Monitor FPS Sync' }));
  expect(r.added).toBe(true);
  const unit = s.units().find((u) => u.source === 'Monitor FPS Sync')!;
  expect(unit).toMatchObject({ kind: 'plugin-param', needsDecision: true, decisionKey: 'param:Fps:Command Name' });
  expect(r.places[0]).toEqual({ where: '플러그인 설정 값', plugin: 'Fps', setting: 'Command Name', unit: { id: unit.id, status: 'untranslated', target: null } });
  expect(s.unit(unit.id)).toBe(unit);
  expect(pushed).toBe(1);
  expect(before.every((id) => s.unit(id))).toBe(true);
  expect(s.entry(item.id).target).toBe('월광초');
  expect(JSON.parse(await readFile(path.join(s.projectDir, EXTRACT_FILE), 'utf8'))).toEqual({ extraStrings: ['Monitor FPS Sync'], extractorVersion: EXTRACTOR_VERSION });
  expect(s.decisionGroups().some((g) => g.key === 'param:Fps:Command Name')).toBe(true);

  // The new unit is translated like any needs-decision unit.
  await s.setTranslation(unit.id, '모니터 FPS 동기화', 'chat');
  expect(s.entry(unit.id).target).toBe('모니터 FPS 동기화');

  // Again: already a unit, nothing written.
  expect(data(await callTool(s, 'add_extract_text', { text: 'Monitor FPS Sync' }))).toMatchObject({ added: false, reason: '이미 번역 항목입니다' });
  expect(pushed).toBe(1);
});

test('add_extract_text: 플러그인 설정에 없으면 넣지 않고 어디 있는지만 답한다', async () => {
  const s = await open();
  const r = data(await callTool(s, 'add_extract_text', { text: 'EV001' }));
  expect(r).toEqual({ added: false, reason: '플러그인 설정에 없어 넣지 않았습니다', total: 1, places: [{ where: 'data 파일', file: 'data/Map001.json', count: 1, unit: null }] });
  expect(data(await callTool(s, 'add_extract_text', { text: 'nowhere' }))).toEqual({ added: false, reason: '게임에서 찾지 못했습니다', total: 0, places: [] });
  expect(await s.extraStrings()).toEqual([]);
});

test('옛 추출기로 만든 프로젝트를 열면 다시 추출해 새 항목이 생기고 번역표와 기록은 그대로다', async () => {
  const s = await open();
  const dir = s.projectDir;
  const keyIds = s.units().filter((u) => u.refs[0].type === 'key').map((u) => u.id);
  expect(keyIds).toHaveLength(3);
  const item = s.units().find((u) => u.source === '月光草')!;
  await s.setTranslation(item.id, '월광초', 'user');
  await s.setDecision('param:Speed:Speed Term', { translate: true, keep: { mode: 'whole' } }, 'user');
  await s.close();
  svc = null;

  // What a project made by the previous version looks like: no key units, no extract.json.
  const unitsFile = path.join(dir, 'units.json');
  const old = JSON.parse(await readFile(unitsFile, 'utf8')) as { id: string }[];
  await writeFile(unitsFile, JSON.stringify(old.filter((u) => !keyIds.includes(u.id))));
  await rm(path.join(dir, EXTRACT_FILE));
  const translations = await readFile(path.join(dir, 'translations.json'), 'utf8');
  const decisions = await readFile(path.join(dir, 'decisions.json'), 'utf8');
  const history = await readFile(path.join(dir, 'history.json'), 'utf8');

  svc = await ProjectService.open(dir);
  expect(keyIds.every((id) => svc!.unit(id))).toBe(true);
  expect(old.every((u) => svc!.unit(u.id))).toBe(true);
  expect(svc.entry(item.id).target).toBe('월광초');
  expect(await readFile(path.join(dir, 'translations.json'), 'utf8')).toBe(translations);
  expect(await readFile(path.join(dir, 'decisions.json'), 'utf8')).toBe(decisions);
  expect(await readFile(path.join(dir, 'history.json'), 'utf8')).toBe(history);
  expect(JSON.parse(await readFile(path.join(dir, EXTRACT_FILE), 'utf8')).extractorVersion).toBe(EXTRACTOR_VERSION);
  expect(JSON.parse(await readFile(unitsFile, 'utf8'))).toHaveLength(svc.units().length);
});

test('채팅 시스템 프롬프트는 찾기 도구를 쓰라고 한다', () => {
  const p = buildSystemPrompt({ name: 'x', engine: 'MZ' } as any, { total: 0, untranslated: 0, translated: 0, needsReview: 0, approved: 0, error: 0, needsDecision: 0 } as any);
  expect(p).toContain('번역 항목에 없는 화면 글자는 어디 있는지 추측하지 말고 find_game_text 로 찾는다');
});
