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

async function open(opts: { profiles?: boolean } = {}): Promise<ProjectService> {
  const game = await makeTempDir();
  await makeMiniGame(game, { keys: true, ...opts });
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

test('find_game_text: 메모 칸 안의 글 일부로 찾고, 어느 블록인지와 번역 항목인지 답한다', async () => {
  const s = await open({ profiles: true });
  const unit = s.units().find((u) => u.source === '地下迷宮で古い鍵を見つけた。\n夜ごと鍵の夢を見る。')!;
  const r = data(await callTool(s, 'find_game_text', { text: '古い鍵を見つけた' }));
  expect(r).toEqual({ total: 1, places: [{
    where: 'data 파일 문자열의 일부', file: 'data/Actors.json', field: '1번 항목의 note', tag: 'profile Switch: 704',
    snippet: '…e>\n<profile Switch: 704>\n地下迷宮で古い鍵を見つけた。\n夜ごと鍵の夢を見る。\n</profile>\n<Custo…',
    unit: { id: unit.id, status: 'untranslated', target: null },
  }] });

  // Outside any tag block: found, but not a unit.
  const actors = JSON.parse(await readFile(path.join(s.projectDir, 'original/v1/data/Actors.json'), 'utf8'));
  expect(actors[1].note).toContain('<CustomStat: ona=0>');
  const stat = data(await callTool(s, 'find_game_text', { text: 'CustomStat' }));
  expect(stat.places).toEqual([expect.objectContaining({ file: 'data/Actors.json', field: '1번 항목의 note', unit: null })]);
  expect(stat.places[0].tag).toBeUndefined();

  // A part of a plugin setting value and of a dialogue line.
  const label = data(await callTool(s, 'find_game_text', { text: 'FPS Sync' }));
  expect(label.places).toContainEqual({ where: '플러그인 설정 값의 일부', plugin: 'Fps', setting: 'Command Name', snippet: 'Monitor FPS Sync', unit: null });
  const line = data(await callTool(s, 'find_game_text', { text: '夜に来る' }));
  expect(line.places).toEqual([expect.objectContaining({ file: 'data/Map001.json', unit: expect.objectContaining({ id: s.units().find((u) => u.source.includes('こんな夜に来るなんて'))!.id }) })]);

  // A line shared by several blocks of one note: one place per block.
  actors[1].note = '<profile>\n共通の一行\n</profile>\n<profile Switch: 1>\n共通の一行\n</profile>\n<profile Switch: 2>\n別\n</profile>';
  await writeFile(path.join(s.projectDir, 'original/v1/data/Actors.json'), JSON.stringify(actors));
  const shared = data(await callTool(s, 'find_game_text', { text: '共通の一行' }));
  expect(shared.places.map((p: { tag: string }) => p.tag)).toEqual(['profile', 'profile Switch: 1']);
});

test('find_game_text: 두 글자 이하는 일부 찾기를 하지 않고, 결과는 10곳까지', async () => {
  const s = await open({ profiles: true });
  expect(data(await callTool(s, 'find_game_text', { text: '古い' }))).toEqual({ total: 0, places: [] });

  // Twelve long descriptions holding the text: ten places, each a short piece around it.
  const file = path.join(s.projectDir, 'original/v1/data/Items.json');
  const items = JSON.parse(await readFile(file, 'utf8'));
  for (let i = 2; i <= 13; i++) items.push({ id: i, name: `草${i}`, description: 'あ'.repeat(100) + '光る苔' + 'い'.repeat(100), note: '' });
  await writeFile(file, JSON.stringify(items));
  const r = data(await callTool(s, 'find_game_text', { text: '光る苔' }));
  expect(r.total).toBe(12);
  expect(r.places).toHaveLength(10);
  expect(r.places[0]).toEqual({ where: 'data 파일 문자열의 일부', file: 'data/Items.json', field: '2번 항목의 description', snippet: '…' + 'あ'.repeat(30) + '光る苔' + 'い'.repeat(30) + '…', unit: null });
});

test('조건 붙은 블록이 없던 추출기 버전 1 프로젝트를 열면 새 프로필 항목이 생기고 번역표는 그대로다', async () => {
  const s = await open({ profiles: true });
  const dir = s.projectDir;
  const base = s.units().find((u) => u.source === '薬草園の見習い。')!;
  const cond = s.units().find((u) => (u.refs[0] as { tag?: string }).tag === 'profile Switch: 704')!;
  await s.setTranslation(base.id, '약초원의 견습생.', 'user');
  await s.close();
  svc = null;

  const unitsFile = path.join(dir, 'units.json');
  const old = JSON.parse(await readFile(unitsFile, 'utf8')) as { id: string }[];
  await writeFile(unitsFile, JSON.stringify(old.filter((u) => u.id !== cond.id)));
  await writeFile(path.join(dir, EXTRACT_FILE), JSON.stringify({ extraStrings: [], extractorVersion: 1 }));
  const translations = await readFile(path.join(dir, 'translations.json'), 'utf8');

  svc = await ProjectService.open(dir);
  expect(EXTRACTOR_VERSION).toBe(2);
  expect(svc.unit(cond.id)).toMatchObject({ decisionKey: 'note:Actors:profile' });
  expect(old.every((u) => svc!.unit(u.id))).toBe(true);
  expect(svc.unit(base.id)!.refs).toEqual(base.refs);
  expect(svc.entry(base.id).target).toBe('약초원의 견습생.');
  expect(await readFile(path.join(dir, 'translations.json'), 'utf8')).toBe(translations);
});

test('채팅 시스템 프롬프트는 찾기 도구를 쓰라고 한다', () => {
  const p = buildSystemPrompt({ name: 'x', engine: 'MZ' } as any, { total: 0, untranslated: 0, translated: 0, needsReview: 0, approved: 0, error: 0, needsDecision: 0 } as any);
  expect(p).toContain('번역 항목에 없는 화면 글자는 어디 있는지 추측하지 말고 find_game_text 로 찾는다');
});
