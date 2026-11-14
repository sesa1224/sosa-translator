import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { unzipSync } from 'fflate';
import { afterAll, expect, test } from 'vitest';
import { decryptAsset, encryptAsset } from '../../src/core/engine/crypto.js';
import { detectGame } from '../../src/core/engine/detect.js';
import type { Region } from '../../src/core/images/types.js';
import { ImageService, registerImageContributor } from '../../src/main/images.js';
import { ProjectService } from '../../src/main/projectService.js';
import type { RenderJob, SheetJob } from '../../src/main/render/renderService.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';
import { ENCRYPTION_KEY, makeMiniGame } from '../helpers/miniGame.js';
import { makePng } from '../helpers/png.js';

afterAll(cleanupTempDirs);

const RENDERED = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const FONT = 'C:/fonts/ok.ttf';

class FakeRender {
  jobs: RenderJob[] = [];
  sheets: SheetJob[] = [];
  thumbs: { png: Uint8Array; maxSide: number }[] = [];
  async render(job: RenderJob): Promise<Uint8Array> {
    this.jobs.push(job);
    if (job.regions.some((r) => r.text === 'boom')) throw new Error('그림을 찍지 못했습니다: 일부러 낸 오류');
    return RENDERED;
  }
  async sheet(job: SheetJob): Promise<Uint8Array> {
    this.sheets.push(job);
    return Uint8Array.from([7]);
  }
  async thumbnail(png: Uint8Array, maxSide: number): Promise<Uint8Array> {
    this.thumbs.push({ png, maxSide });
    return Uint8Array.from([8]);
  }
}

/** Mini game (encrypted images, MZ or MV www) with img/pictures/menu.png and encrypted img/titles1/c.png_. */
async function setup(o: { www?: boolean; extra?: (img: string) => Promise<void> } = {}) {
  const gameDir = await makeTempDir();
  await makeMiniGame(gameDir, { encrypted: true, engine: o.www ? 'MV' : 'MZ', www: o.www });
  const content = o.www ? path.join(gameDir, 'www') : gameDir;
  const img = path.join(content, 'img');
  await rm(img, { recursive: true, force: true });
  await mkdir(path.join(img, 'pictures'), { recursive: true });
  await mkdir(path.join(img, 'titles1'), { recursive: true });
  await writeFile(path.join(img, 'pictures', 'menu.png'), makePng(40, 20, [255, 0, 0, 255]));
  await writeFile(path.join(img, 'titles1', 'c.png_'), encryptAsset(makePng(30, 30, [0, 0, 255, 255]), ENCRYPTION_KEY));
  await o.extra?.(img);
  const proj = path.join(await makeTempDir(), 'proj');
  const svc = await ProjectService.create(gameDir, proj, '약초원');
  const render = new FakeRender();
  const images = new ImageService({
    svc, game: await detectGame(gameDir), render,
    fontExists: (p) => p === FONT, readFont: async () => Uint8Array.from([1, 1, 1]),
  });
  const changed: string[][] = [];
  images.on('changed', (files: string[]) => changed.push(files));
  return { gameDir, img, proj, svc, render, images, changed };
}

const region = (p: Partial<Region> = {}) => ({ rect: { x: 2, y: 2, w: 20, h: 10 }, erase: 'fill' as const, fillColor: '#000000', text: '', ...p });

test('지시서를 쓰면 할 것이 되고 원본 해시가 기록된다', async () => {
  const { images, changed } = await setup();
  const entries = await images.list();
  const menu = entries.find((e) => e.file === 'img/pictures/menu.png')!;
  expect(menu.status).toBe('none');
  const r = await images.setRecipe('img/pictures/menu.png', [region()], 'claude');
  expect(r.status).toBe('todo');
  expect(r.baseHash).toBe(menu.hash);
  expect(images.recipe('img/pictures/menu.png')?.regions).toHaveLength(1);
  expect((await images.list()).find((e) => e.file === 'img/pictures/menu.png')!.status).toBe('todo');
  expect(changed.at(-1)).toEqual(['img/pictures/menu.png']);
});

test('찍은 그림은 캐시하고, 지시서가 바뀌면 다시 찍는다', async () => {
  const { images, render } = await setup();
  await images.setRecipe('img/pictures/menu.png', [region()], 'user');
  expect(await images.rendered('img/pictures/menu.png')).toEqual(RENDERED);
  expect(await images.rendered('img/pictures/menu.png')).toEqual(RENDERED);
  expect(render.jobs).toHaveLength(1);
  await images.setRecipe('img/pictures/menu.png', [region({ fillColor: '#ffffff' })], 'user');
  await images.rendered('img/pictures/menu.png');
  expect(render.jobs).toHaveLength(2);
  expect(await images.rendered('img/pictures/sub/none.png')).toBeNull();
});

test('원본이 바뀌면 base-changed 로 빌드에서 빠지고, 확인하면 들어간다', async () => {
  const { images, img } = await setup();
  await images.setRecipe('img/pictures/menu.png', [region()], 'user');
  await images.setStatus('img/pictures/menu.png', 'done');
  expect((await images.buildFiles('')).files.has('img/pictures/menu.png')).toBe(true);
  await writeFile(path.join(img, 'pictures', 'menu.png'), makePng(40, 20, [0, 255, 0, 255]));
  expect((await images.list()).find((e) => e.file === 'img/pictures/menu.png')!.problem).toBe('base-changed');
  const b = await images.buildFiles('');
  expect(b.files.has('img/pictures/menu.png')).toBe(false);
  expect(b.skipped).toEqual([]);
  await images.acceptBase('img/pictures/menu.png');
  expect((await images.list()).find((e) => e.file === 'img/pictures/menu.png')!.problem).toBeUndefined();
  expect((await images.buildFiles('')).files.has('img/pictures/menu.png')).toBe(true);
});

test('폰트가 없으면 font-missing, 기본 폰트를 정하면 풀린다', async () => {
  const { images } = await setup();
  await images.setRecipe('img/pictures/menu.png', [region({ text: '메뉴' })], 'user');
  await images.setStatus('img/pictures/menu.png', 'done');
  expect((await images.list()).find((e) => e.file === 'img/pictures/menu.png')!.problem).toBe('font-missing');
  expect((await images.buildFiles('')).files.size).toBe(0);
  await images.setDefaultFont(FONT);
  expect((await images.list()).find((e) => e.file === 'img/pictures/menu.png')!.problem).toBeUndefined();
  expect((await images.buildFiles('')).files.has('img/pictures/menu.png')).toBe(true);
});

test('암호화 그림은 같은 키로 다시 암호화해 같은 경로에 넣는다 (MZ, MV www)', async () => {
  for (const www of [false, true]) {
    const { images } = await setup({ www });
    await images.setRecipe('img/titles1/c.png', [region()], 'user');
    await images.setStatus('img/titles1/c.png', 'done');
    const prefix = www ? 'www/' : '';
    const { files } = await images.buildFiles(prefix);
    expect([...files.keys()]).toEqual([`${prefix}img/titles1/c.png_`]);
    expect(decryptAsset(files.get(`${prefix}img/titles1/c.png_`)!, ENCRYPTION_KEY)).toEqual(RENDERED);
  }
});

test('직접 고친 그림: 크기가 다르면 오류, 같으면 manual 로 빌드에 들어간다', async () => {
  const { images } = await setup();
  const dir = await makeTempDir();
  const wrong = path.join(dir, 'wrong.png');
  const right = path.join(dir, 'right.png');
  await writeFile(wrong, makePng(10, 10));
  const fixed = makePng(40, 20, [9, 9, 9, 255]);
  await writeFile(right, fixed);
  await expect(images.setManual('img/pictures/menu.png', wrong)).rejects.toThrow('직접 고친 그림의 크기가 원본과 달라요(원본 40x20)');
  await images.setManual('img/pictures/menu.png', right);
  expect(images.recipe('img/pictures/menu.png')?.status).toBe('manual');
  expect((await images.buildFiles('')).files.get('img/pictures/menu.png')).toEqual(fixed);
  await images.setManual('img/pictures/menu.png', null);
  expect(images.recipe('img/pictures/menu.png')?.manualFile).toBeUndefined();
  expect((await images.buildFiles('')).files.size).toBe(0);
});

test('찍기가 실패한 그림만 skipped, 다른 그림은 들어간다', async () => {
  const { images } = await setup();
  await images.setDefaultFont(FONT);
  await images.setRecipe('img/pictures/menu.png', [region({ text: 'boom' })], 'user');
  await images.setStatus('img/pictures/menu.png', 'done');
  await images.setRecipe('img/titles1/c.png', [region()], 'user');
  await images.setStatus('img/titles1/c.png', 'done');
  const r = await images.buildFiles('');
  expect([...r.files.keys()]).toEqual(['img/titles1/c.png_']);
  expect(r.skipped).toEqual([{ file: 'img/pictures/menu.png', reason: '그림을 찍지 못했습니다: 일부러 낸 오류' }]);
  expect((await images.list()).find((e) => e.file === 'img/pictures/menu.png')!.problem).toBe('render-failed');
});

test('모음판은 20개씩 나뉘고, 크게 보기는 줄인 비율을 준다', async () => {
  const { images, render } = await setup({
    extra: async (img) => {
      await mkdir(path.join(img, 'parallaxes'), { recursive: true });
      for (let i = 0; i < 20; i++) await writeFile(path.join(img, 'pictures', `p${String(i).padStart(2, '0')}.png`), makePng(8, 8));
      await writeFile(path.join(img, 'parallaxes', 'wide.png'), makePng(3000, 1000));
    },
  });
  const first = await images.sheet({ page: 1 });
  expect(first.pages).toBe(2);
  expect(first.items).toHaveLength(20);
  expect(first.items[0]).toMatchObject({ n: 1, width: expect.any(Number), status: 'none' });
  expect(render.sheets[0]).toMatchObject({ columns: 5 });
  expect(render.sheets[0].cells).toHaveLength(20);
  const second = await images.sheet({ page: 2 });
  expect(second.items.map((i) => i.n)).toEqual([1, 2, 3]);
  const pics = await images.sheet({ page: 1, folder: 'img/parallaxes' });
  expect(pics.items.map((i) => i.file)).toEqual(['img/parallaxes/wide.png']);
  const v = await images.view('img/parallaxes/wide.png', 'original');
  expect(v.scale).toBeCloseTo(0.52, 2);
  expect(render.thumbs.at(-1)!.maxSide).toBe(1568);
});

test('그림 속 글의 용어 검사가 메모로 남는다', async () => {
  const { images, svc } = await setup();
  await svc.upsertTerm({ source: 'メニュー', target: '메뉴', category: 'term', status: 'confirmed', candidates: [] });
  const r = await images.setRecipe('img/pictures/menu.png', [region({ text: '차림표', source: 'メニュー' })], 'claude');
  expect(r.note).toContain('메뉴');
  const ok = await images.setRecipe('img/pictures/menu.png', [region({ text: '메뉴', source: 'メニュー' })], 'claude');
  expect(ok.note).toBeUndefined();
});

test('원본 내보내기: 풀린 PNG 를 폴더 구조 그대로 쓰고, 없는 그림은 실패로 남긴다', async () => {
  const { images, changed } = await setup();
  const out = path.join(await makeTempDir(), 'export');
  const before = changed.length;
  const r = await images.exportOriginals(['img/pictures/menu.png', 'img/titles1/c.png', 'img/pictures/none.png'], out);
  expect(r.written).toBe(2);
  expect(r.failed).toEqual([{ file: 'img/pictures/none.png', reason: expect.any(String) }]);
  expect(new Uint8Array(await readFile(path.join(out, 'img', 'pictures', 'menu.png')))).toEqual(makePng(40, 20, [255, 0, 0, 255]));
  const c = new Uint8Array(await readFile(path.join(out, 'img', 'titles1', 'c.png')));
  expect(c).toEqual(makePng(30, 30, [0, 0, 255, 255]));
  expect(c).toEqual(await images.original('img/titles1/c.png'));
  expect(existsSync(path.join(out, 'img', 'pictures', 'none.png'))).toBe(false);
  expect(changed.length).toBe(before);
});

test('원본 내보내기: 게임 폴더 안으로는 쓰지 않는다', async () => {
  const { images, gameDir } = await setup({ www: true });
  const caseVariants = process.platform === 'win32' ? [gameDir.toUpperCase()] : [];
  for (const dir of [gameDir, path.join(gameDir, 'www', 'export'), ...caseVariants]) {
    await expect(images.exportOriginals(['img/pictures/menu.png'], dir)).rejects.toThrow('게임 폴더 안으로는 내보낼 수 없습니다');
  }
  expect(existsSync(path.join(gameDir, 'img'))).toBe(false);
  expect(existsSync(path.join(gameDir, 'www', 'export'))).toBe(false);
});

test('기여자를 등록한 빌드의 zip 에 그림이 들어 있다', async () => {
  const { images, svc } = await setup();
  registerImageContributor(svc, images);
  await images.setRecipe('img/pictures/menu.png', [region()], 'user');
  await images.setStatus('img/pictures/menu.png', 'done');
  const r = await svc.build();
  const zip = unzipSync(new Uint8Array(await readFile(r.zipPath)));
  expect(zip['img/pictures/menu.png']).toEqual(RENDERED);
});
