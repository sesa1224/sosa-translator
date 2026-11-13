import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { extractJsStrings } from '../../src/core/extract/pluginJs.js';
import { extractAll } from '../../src/core/extract/index.js';
import { setupProject } from '../helpers/project.js';
import { cleanupTempDirs } from '../helpers/fs.js';

afterAll(cleanupTempDirs);

function sources(js: string): string[] {
  return extractJsStrings(js, 'js/plugins/A.js').map((u) => u.source);
}

test('주석 밖의 일본어 문자열, 이스케이프는 그대로', () => {
  const js = 'var a = "表示"; // "コメント"\n/* "ブロック" */ var b = \'値\\\'だ\';';
  const units = extractJsStrings(js, 'js/plugins/A.js');
  expect(units.map((u) => u.source)).toEqual(['表示', '値\\\'だ']);
  for (const u of units) {
    const ref = u.ref as { type: 'js'; start: number; end: number; quote: string };
    expect(ref.type).toBe('js');
    expect(js.slice(ref.start, ref.end)).toBe(u.source);
    expect(u).toMatchObject({ kind: 'plugin-js', needsDecision: true, decisionKey: 'js:A.js' });
  }
  expect((units[1].ref as { quote: string }).quote).toBe("'");
});

test('정규식 리터럴과 나눗셈', () => {
  expect(sources('var r = /["\']日本語/; var s = "後";')).toEqual(['後']);
  expect(sources('var x = a / b / "割る";')).toEqual(['割る']);
  expect(sources('if (/[/"]/.test(s)) t = "真";')).toEqual(['真']);
  expect(sources('return /あ"/g.test(x) ? "はい" : "いいえ";')).toEqual(['はい', 'いいえ']);
});

test('템플릿 문자열: ${} 가 있으면 건너뛴다', () => {
  expect(sources('var a = `ようこそ`; var b = `${name}さん`; var c = "後";')).toEqual(['ようこそ', '後']);
  expect(sources('var b = `${ {a: "中"}.a }さん`; var c = "後";')).toEqual(['後']);
});

test('추출: 켜진 플러그인 파일만, 위치마다 하나, 깨진 파일은 경고', async () => {
  const fx = await setupProject();
  const orig = path.join(fx.proj, 'original/v1/js');
  await mkdir(path.join(orig, 'plugins'), { recursive: true });
  await writeFile(path.join(orig, 'plugins.js'), 'var $plugins =\n' + JSON.stringify([
    { name: 'On', status: true, description: '', parameters: {} },
    { name: 'Off', status: false, description: '', parameters: {} },
    { name: 'Broken', status: true, description: '', parameters: {} },
  ]) + ';\n');
  await writeFile(path.join(orig, 'plugins/On.js'), 'var a = "同じ"; var b = "同じ";');
  await writeFile(path.join(orig, 'plugins/Off.js'), 'var a = "消えた";');
  await writeFile(path.join(orig, 'plugins/Broken.js'), 'var a = "閉じない;\nvar b = 1;');
  const { units, warnings } = await extractAll(fx.proj);
  const js = units.filter((u) => u.kind === 'plugin-js');
  expect(js.map((u) => [u.source, u.refs.length, u.decisionKey])).toEqual([['同じ', 1, 'js:On.js'], ['同じ', 1, 'js:On.js']]);
  expect(new Set(js.map((u) => u.id)).size).toBe(2);
  expect(js[0].refs[0]).toMatchObject({ type: 'js', file: 'js/plugins/On.js', quote: '"' });
  expect(warnings).toEqual([{ file: 'js/plugins/Broken.js', message: expect.stringContaining('따옴표') }]);
});
