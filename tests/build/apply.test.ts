import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { applyTranslations } from '../../src/core/build/apply.js';
import type { TranslationStore } from '../../src/core/store/translations.js';
import type { TextUnit } from '../../src/core/types.js';
import { cleanupTempDirs, hashDir } from '../helpers/fs.js';
import { PLUGINS_JS_TEXT } from '../helpers/miniGame.js';
import { setupProject, translator } from '../helpers/project.js';

let proj: string;
let units: TextUnit[];
let store: TranslationStore;
let tr: ReturnType<typeof translator>;
let before: string;
let pluginsText: string;

beforeAll(async () => {
  ({ proj, units, store } = await setupProject());
  tr = translator(units, store);
  before = await hashDir(path.join(proj, 'original'));
  pluginsText = await readFile(path.join(proj, 'original/v1/js/plugins.js'), 'utf8');
  expect(pluginsText).toBe(PLUGINS_JS_TEXT);
});
afterAll(cleanupTempDirs);

test('번역 없으면 빈 결과', async () => { expect((await applyTranslations(proj, units, store)).size).toBe(0); });
test('줄 수가 늘어도 뒤쪽이 제자리에 들어간다', async () => {
  tr('あれ？\\N[1]じゃない！\nこんな夜に来るなんて', '어라?\n\\N[1] 아니야!\n이런 밤에 오다니');
  tr('やった！', '해냈다!'); tr('いいよ', '좋아'); tr('また今度', '다음에');
  const list = JSON.parse((await applyTranslations(proj, units, store)).get('data/Map001.json')!).events[1].pages[0].list;
  expect(list.map((c: any) => c.code)).toEqual([101, 401, 401, 401, 102, 402, 101, 401, 0, 402, 0, 404, 356, 0]);
  expect(list.slice(1, 4).map((c: any) => c.parameters[0])).toEqual(['어라?', '\\N[1] 아니야!', '이런 밤에 오다니']);
  expect(list[4].parameters[0]).toEqual(['좋아', '다음에']);
  expect(list[5].parameters).toEqual([0, '좋아']); expect(list[9].parameters).toEqual([1, '다음에']);
  expect(list[7]).toEqual({ code: 401, indent: 1, parameters: ['해냈다!'] });
});
test('같은 원문은 모든 자리에 들어간다', async () => {
  tr('リナ', '리나'); const out = await applyTranslations(proj, units, store);
  expect(JSON.parse(out.get('data/Actors.json')!)[1].name).toBe('리나');
  expect(JSON.parse(out.get('data/Map001.json')!).events[1].pages[0].list[0].parameters[4]).toBe('리나');
});
test('판단 필요 항목은 승인돼야 들어간다', async () => {
  tr('物語', '이야기'); expect((await applyTranslations(proj, units, store)).has('js/plugins.js')).toBe(false);
  tr('物語', '이야기', 'approved');
  expect((await applyTranslations(proj, units, store)).get('js/plugins.js')).toBe(pluginsText.replace('物語', '이야기'));
});
test('오류 상태는 건너뛴다', async () => {
  tr('月光草', '월광초', 'error'); expect((await applyTranslations(proj, units, store)).has('data/Items.json')).toBe(false);
});
test('원본 사본은 바뀌지 않는다', async () => { expect(await hashDir(path.join(proj, 'original'))).toBe(before); });

// Extra coverage: fewer lines than the source, and the speaker name inside the second 101.
test('줄 수가 줄어도 맞고, 두 번째 101 의 화자도 바뀐다', async () => {
  tr('あれ？\\N[1]じゃない！\nこんな夜に来るなんて', '어라, \\N[1] 아니야!');
  const list = JSON.parse((await applyTranslations(proj, units, store)).get('data/Map001.json')!).events[1].pages[0].list;
  expect(list.map((c: any) => c.code)).toEqual([101, 401, 102, 402, 101, 401, 0, 402, 0, 404, 356, 0]);
  expect(list[4].parameters[4]).toBe('리나');
  expect(list[7].parameters).toEqual([1, '다음에']);
});
