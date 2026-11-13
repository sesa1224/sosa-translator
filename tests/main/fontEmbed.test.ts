import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import * as otNs from 'opentype.js';
import { afterAll, expect, test } from 'vitest';
import { savePatches } from '../../src/core/patches/store.js';
import type { Patch, PatchBody } from '../../src/core/patches/types.js';
import type { TextUnit, TranslationEntry } from '../../src/core/types.js';
import { fontPatchFiles, registerFontContributor, usedCharacters } from '../../src/main/fontEmbed.js';
import { ProjectService } from '../../src/main/projectService.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';
import { makeMiniGame } from '../helpers/miniGame.js';
import { makeTestFont } from '../helpers/testFont.js';

const ot: any = (otNs as any).parse ? otNs : (otNs as any).default;

afterAll(cleanupTempDirs);

const GLYPHS = { '가': 1000, '나': 1000, '다': 1000, A: 600, '1': 500, '…': 1000, '♥': 1000, ' ': 300 };

function patch(body: PatchBody, o: Partial<Patch> = {}): Patch {
  return { id: `p-${Math.random()}`, title: 't', note: '', enabled: true, originalBug: false, createdBy: 'user', createdAt: '', body, ...o };
}

function cmapChars(bytes: Uint8Array): string[] {
  const f = ot.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  const out: string[] = [];
  for (let i = 0; i < f.glyphs.length; i++) {
    const g = f.glyphs.get(i);
    for (const u of g.unicodes ?? []) if (u > 0) out.push(String.fromCodePoint(u));
  }
  return out.sort();
}

test('usedCharacters 는 번역문, 기본 글자, 수정으로 넣은 글자를 중복 없이 준다', () => {
  const units = [{ id: 'a' }, { id: 'b' }, { id: 'c' }] as TextUnit[];
  const entries: Record<string, Partial<TranslationEntry>> = { a: { target: '안녕 안녕' }, b: { target: null }, c: { target: '\\C[2]별' } };
  const p = patch({ kind: 'event', file: 'data/Map001.json', listPath: [], baseHash: '', ops: [{ op: 'insert', after: 0, commands: [{ code: 401, indent: 0, parameters: ['고친대사'] }] }] });
  const s = usedCharacters(units, (id) => entries[id] as TranslationEntry, [p], '추');
  const chars = [...s];
  for (const ch of ['안', '녕', '별', '0', '9', '…', '♥', '고', '친', '대', '사', '추', 'C', '\\', '　']) expect(chars).toContain(ch);
  expect(new Set(chars).size).toBe(chars.length);
});

test('subset: true 면 쓰는 글자만 남고 작아진다, false 면 바이트가 같다, 없는 글자 수를 센다', async () => {
  const dir = await makeTempDir();
  const fontPath = await makeTestFont(dir, { name: 'Tiny', glyphs: GLYPHS });
  const original = new Uint8Array(await readFile(fontPath));
  const base = { engine: 'MZ' as const, contentPrefix: '', projectDir: dir, fontPath };
  const sub = await fontPatchFiles({ ...base, subset: true, chars: '가A1' });
  const bytes = sub.files.get('fonts/mvmz-game-font.ttf') as Uint8Array;
  expect(cmapChars(bytes)).toEqual(['1', 'A', '가']);
  expect(bytes.length).toBeLessThan(original.length);
  expect(sub.bytes).toBe(bytes.length);
  expect(sub.missing).toBe(0);
  const whole = await fontPatchFiles({ ...base, subset: false, chars: '가A1' });
  expect(whole.files.get('fonts/mvmz-game-font.ttf')).toEqual(original);
  const miss = await fontPatchFiles({ ...base, subset: true, chars: '가A1쀍쀎쀏' });
  expect(miss.missing).toBe(3);
});

test('MZ: 파일 키와 mainFontFilename 수정', async () => {
  const dir = await makeTempDir();
  const fontPath = await makeTestFont(dir, { name: 'Tiny', glyphs: GLYPHS });
  const r = await fontPatchFiles({ engine: 'MZ', contentPrefix: '', projectDir: dir, fontPath, subset: false, chars: '' });
  expect([...r.files.keys()]).toEqual(['fonts/mvmz-game-font.ttf']);
  expect(r.jsonPatch).toEqual({ file: 'data/System.json', path: ['advanced', 'mainFontFilename'], value: 'mvmz-game-font.ttf' });
});

async function openProject(engine: 'MV' | 'MZ', www: boolean): Promise<{ svc: ProjectService; game: string; fontPath: string }> {
  const game = await makeTempDir();
  await makeMiniGame(game, { engine, www });
  const proj = path.join(await makeTempDir(), 'proj');
  const svc = await ProjectService.create(game, proj, '약초원');
  const fontPath = await makeTestFont(await makeTempDir(), { name: 'Tiny', glyphs: GLYPHS });
  registerFontContributor(svc);
  return { svc, game, fontPath };
}

test('MZ: 기여자를 거친 빌드의 System.json 에 폰트 이름과 제목 번역이 같이 있다', async () => {
  const { svc, fontPath } = await openProject('MZ', false);
  await svc.setGameTitle('안개 약초원');
  await savePatches(svc.projectDir, [patch({ kind: 'font', fontPath, subset: true })]);
  const r = await svc.build();
  const zip = unzipSync(await readFile(r.zipPath));
  const sys = JSON.parse(strFromU8(zip['data/System.json']));
  expect(sys.advanced.mainFontFilename).toBe('mvmz-game-font.ttf');
  expect(sys.gameTitle).toBe('안개 약초원');
  expect(zip['fonts/mvmz-game-font.ttf']).toBeTruthy();
  expect(r.files.filter((f) => f.path === 'data/System.json')).toHaveLength(1);
  await svc.close();
});

test('MV(www): gamefont.css 의 GameFont 블록 src 만 바뀐다', async () => {
  const game = await makeTempDir();
  await makeMiniGame(game, { engine: 'MV', www: true });
  const css = '@font-face {\n    font-family: GameFont;\n    src: url("mplus-1m-regular.woff");\n}\n\n@font-face {\n  font-family: Other;\n  src: url("other.woff");\n}\n';
  await mkdir(path.join(game, 'www', 'fonts'), { recursive: true });
  await writeFile(path.join(game, 'www', 'fonts', 'gamefont.css'), css);
  const proj = path.join(await makeTempDir(), 'proj');
  const svc = await ProjectService.create(game, proj, '약초원');
  const fontPath = await makeTestFont(await makeTempDir(), { name: 'Tiny', glyphs: GLYPHS });
  const r = await fontPatchFiles({ engine: 'MV', contentPrefix: 'www/', projectDir: proj, fontPath, subset: false, chars: '' });
  expect([...r.files.keys()].sort()).toEqual(['www/fonts/gamefont.css', 'www/fonts/mvmz-game-font.ttf']);
  expect(r.jsonPatch).toBeUndefined();
  const out = r.files.get('www/fonts/gamefont.css') as string;
  expect(out).toBe(css.replace('url("mplus-1m-regular.woff")', 'url("mvmz-game-font.ttf")'));
  await svc.close();
});

test('MV: 원본에 css 가 없으면 한 블록짜리 파일', async () => {
  const { svc, fontPath } = await openProject('MV', false);
  const r = await fontPatchFiles({ engine: 'MV', contentPrefix: '', projectDir: svc.projectDir, fontPath, subset: false, chars: '' });
  expect(r.files.get('fonts/gamefont.css')).toBe('@font-face { font-family: GameFont; src: url("mvmz-game-font.ttf"); }\n');
  await svc.close();
});

test('font 수정이 없거나 꺼져 있으면 기여자가 빈 Map, plugin 수정의 JS 는 js/plugins/ 로', async () => {
  const { svc, fontPath } = await openProject('MZ', false);
  const contribute = svc.buildContributors.at(-1)!;
  const ctx = { projectDir: svc.projectDir, contentPrefix: '', number: 1, changed: new Map<string, string>() };
  expect((await contribute(ctx)).size).toBe(0);
  await savePatches(svc.projectDir, [patch({ kind: 'font', fontPath, subset: true }, { enabled: false })]);
  expect((await contribute(ctx)).size).toBe(0);
  await savePatches(svc.projectDir, [patch({ kind: 'plugin', name: 'KoreanFont', js: '// 한글', parameters: {}, description: '' })]);
  const m = await contribute(ctx);
  expect([...m.keys()]).toEqual(['js/plugins/KoreanFont.js']);
  expect(m.get('js/plugins/KoreanFont.js')).toBe('// 한글');
  await svc.close();
});

test('원본 사본이 gamefont.css 를 챙긴다', async () => {
  const game = await makeTempDir();
  await makeMiniGame(game, { engine: 'MV' });
  await mkdir(path.join(game, 'fonts'), { recursive: true });
  await writeFile(path.join(game, 'fonts', 'gamefont.css'), '@font-face { font-family: GameFont; src: url("a.woff"); }');
  const proj = path.join(await makeTempDir(), 'proj');
  const svc = await ProjectService.create(game, proj, '약초원');
  expect((await stat(path.join(proj, 'original', 'v1', 'fonts', 'gamefont.css'))).isFile()).toBe(true);
  await svc.close();
});
