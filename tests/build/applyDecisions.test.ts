import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, beforeEach, expect, test } from 'vitest';
import { applyTranslations, applyTranslationsDetailed } from '../../src/core/build/apply.js';
import { buildPatch } from '../../src/core/build/patch.js';
import { titleFiles } from '../../src/core/build/title.js';
import { saveDecisions } from '../../src/core/decisions/store.js';
import type { Decision, Decisions } from '../../src/core/decisions/types.js';
import { extractAll } from '../../src/core/extract/index.js';
import { TranslationStore } from '../../src/core/store/translations.js';
import type { TextUnit } from '../../src/core/types.js';
import { miniActors, miniItems, PROFILE_NOTE } from '../helpers/miniGame.js';
import { cleanupTempDirs } from '../helpers/fs.js';
import { setupProject, translator } from '../helpers/project.js';

afterAll(cleanupTempDirs);

const A_JS = '/*:\n * @plugindesc テスト\n */\nvar a = "一つ目";\nvar b = \'二つ目\';\n// end\n';
const B_JS = 'var c = "三つ目";\n';

let proj: string;
let units: TextUnit[];
let store: TranslationStore;
let tr: ReturnType<typeof translator>;
const orig = () => path.join(proj, 'original/v1');

beforeEach(async () => {
  ({ proj } = await setupProject());
  const actors = miniActors();
  (actors[1] as { note: string }).note = PROFILE_NOTE;
  await writeFile(path.join(orig(), 'data/Actors.json'), JSON.stringify(actors));
  const items = miniItems();
  (items[1] as { note: string }).note = '<SG説明:夜に光る草>\n<price:100>';
  await writeFile(path.join(orig(), 'data/Items.json'), JSON.stringify(items));
  await mkdir(path.join(orig(), 'js/plugins'), { recursive: true });
  await writeFile(path.join(orig(), 'js/plugins/A.js'), A_JS);
  await writeFile(path.join(orig(), 'js/plugins/B.js'), B_JS);
  const plugins = await readFile(path.join(orig(), 'js/plugins.js'), 'utf8');
  await writeFile(path.join(orig(), 'js/plugins.js'), plugins.replace('}}];', '}},{"name":"A","status":true,"description":"","parameters":{}},{"name":"B","status":true,"description":"","parameters":{}}];'));
  await writeFile(path.join(orig(), 'index.html'), '<!DOCTYPE html>\n<html><head><title>霧の薬草園</title></head><body></body></html>\n');
  await writeFile(path.join(orig(), 'package.top.json'), JSON.stringify({ name: 'kiri-no-yakusouen', window: { title: '霧の薬草園', width: 816 } }));
  ({ units } = await extractAll(proj));
  store = await TranslationStore.load(proj);
  tr = translator(units, store);
});

const yes = (keep: Decision['keep']): Decision => ({ translate: true, keep, status: 'confirmed', by: 'user' });
const files = async (d: Decisions) => applyTranslations(proj, units, store, { decisions: d });
const mapCmd = (out: Map<string, string>) => JSON.parse(out.get('data/Map001.json')!).events[1].pages[0].list[11].parameters[0];

test('결정이 있어야, 뼈대가 맞아야 들어간다', async () => {
  tr('ShowRecord 記録', 'ShowRecord 기록');
  expect((await files({})).has('data/Map001.json')).toBe(false);
  const d = { 'mv:ShowRecord': yes({ mode: 'args', from: 1, dropLast: 0 }) };
  expect(mapCmd(await files(d))).toBe('ShowRecord 기록');
  tr('ShowRecord 記録', '기록 보기');
  expect((await files(d)).has('data/Map001.json')).toBe(false);
});

test('번역 안 함으로 되돌리면 번역이 남아 있어도 빠진다', async () => {
  tr('ShowRecord 記録', 'ShowRecord 기록', 'approved');
  const d: Decisions = { 'mv:ShowRecord': yes({ mode: 'args', from: 1, dropLast: 0 }) };
  expect((await files(d)).has('data/Map001.json')).toBe(true);
  d['mv:ShowRecord'] = { ...d['mv:ShowRecord'], translate: false };
  expect((await files(d)).has('data/Map001.json')).toBe(false);
  expect(store.get(units.find((u) => u.source === 'ShowRecord 記録')!.id).target).toBe('ShowRecord 기록');
  d['mv:ShowRecord'] = { ...d['mv:ShowRecord'], translate: true };
  expect((await files(d)).has('data/Map001.json')).toBe(true);
});

test('메모란: 그 값만 바뀐다', async () => {
  tr('夜に光る草', '밤에 빛나는 풀');
  const out = await files({ 'note:Items:SG説明': yes({ mode: 'whole' }) });
  expect(JSON.parse(out.get('data/Items.json')!)[1].note).toBe('<SG説明:밤에 빛나는 풀>\n<price:100>');
});

test('메모란: 조건 붙은 프로필 블록은 기본 <profile> 의 결정으로 들어가고 그 블록만 바뀐다', async () => {
  const cond = units.find((u) => u.source === '地下迷宮で古い鍵を見つけた。\n夜ごと鍵の夢を見る。')!;
  expect(cond.decisionKey).toBe('note:Actors:profile');
  expect(cond.refs).toEqual([{ type: 'note', file: 'data/Actors.json', path: [1, 'note'], tag: 'profile Switch: 704', index: 0 }]);
  tr('地下迷宮で古い鍵を見つけた。\n夜ごと鍵の夢を見る。', '지하 미궁에서 낡은 열쇠를 찾았다.\n밤마다 열쇠 꿈을 꾼다.');
  const out = await files({ 'note:Actors:profile': yes({ mode: 'whole' }) });
  expect(JSON.parse(out.get('data/Actors.json')!)[1].note)
    .toBe(PROFILE_NOTE.replace('地下迷宮で古い鍵を見つけた。\n夜ごと鍵の夢を見る。', '지하 미궁에서 낡은 열쇠를 찾았다.\n밤마다 열쇠 꿈을 꾼다.'));
});

test('JS: 바뀐 구간만 다르고 따옴표는 이스케이프', async () => {
  tr('一つ目', '첫 "번째"');
  const out = await files({ 'js:A.js': yes({ mode: 'whole' }) });
  expect(out.get('js/plugins/A.js')).toBe(A_JS.replace('一つ目', '첫 \\"번째\\"'));
  expect(out.has('js/plugins/B.js')).toBe(false);
  // A single string can be decided on its own.
  tr('二つ目', "두 '번째'\n줄");
  const id = units.find((u) => u.source === '二つ目')!.id;
  const out2 = await files({ 'js:A.js': yes({ mode: 'whole' }), [`unit:${id}`]: { ...yes({ mode: 'whole' }), translate: false } });
  expect(out2.get('js/plugins/A.js')).toBe(A_JS.replace('一つ目', '첫 \\"번째\\"'));
  const out3 = await files({ 'js:A.js': yes({ mode: 'whole' }) });
  expect(out3.get('js/plugins/A.js')).toBe(A_JS.replace('一つ目', '첫 \\"번째\\"').replace('二つ目', "두 \\'번째\\'\\n줄"));
});

test('JS 원본이 추출 뒤에 바뀌면 그 파일은 빼고 경고', async () => {
  tr('一つ目', '첫 번째');
  tr('三つ目', '세 번째');
  await writeFile(path.join(orig(), 'js/plugins/A.js'), '// 앞에 한 줄 더\n' + A_JS);
  const r = await applyTranslationsDetailed(proj, units, store, { decisions: { 'js:A.js': yes({ mode: 'whole' }), 'js:B.js': yes({ mode: 'whole' }) } });
  expect(r.files.has('js/plugins/A.js')).toBe(false);
  expect(r.files.get('js/plugins/B.js')).toBe('var c = "세 번째";\n');
  expect(r.warnings).toEqual([{ file: 'js/plugins/A.js', message: '추출 뒤에 파일이 바뀌어 적용하지 않았습니다' }]);
});

test('제목: index.html 과 최상위 package.json', async () => {
  tr('霧の薬草園', '안개 약초원');
  await saveDecisions(proj, {});
  const r = await buildPatch(proj, units, store);
  expect(r.warnings).toEqual([]);
  const zip = unzipSync(await readFile(r.zipPath));
  expect(Object.keys(zip).sort()).toEqual(['data/System.json', 'index.html', 'package.json']);
  expect(strFromU8(zip['index.html'])).toContain('<title>안개 약초원</title>');
  const pkg = JSON.parse(strFromU8(zip['package.json']));
  expect(pkg).toEqual({ name: 'kiri-no-yakusouen', window: { title: '안개 약초원', width: 816 } });

  const amp = await titleFiles(proj, 'A & B <1>');
  expect(amp.get('index.html')).toContain('<title>A &amp; B &lt;1&gt;</title>');
  expect(JSON.parse(amp.get('<top>/package.json')!).name).toBe('kiri-no-yakusouen');
  await writeFile(path.join(orig(), 'package.top.json'), JSON.stringify({ name: 'kiri-no-yakusouen', window: { title: '' } }));
  const empty = await titleFiles(proj, '안개 약초원');
  expect([...empty.keys()]).toEqual(['index.html']);
  expect((await titleFiles(proj, null)).size).toBe(0);
});

test('결정은 decisions.json 에서 읽고, 뼈대 오류는 error 로 표시된다', async () => {
  tr('ShowRecord 記録', '기록 보기');
  tr('月光草', '월광초');
  await saveDecisions(proj, { 'mv:ShowRecord': yes({ mode: 'args', from: 1, dropLast: 0 }) });
  const r = await buildPatch(proj, units, store);
  expect(r.files.map((f) => f.path)).toEqual(['data/Items.json']);
  expect(store.get(units.find((u) => u.source === 'ShowRecord 記録')!.id).status).toBe('error');
});
