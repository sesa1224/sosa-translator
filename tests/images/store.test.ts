import { afterAll, expect, test } from 'vitest';
import { isBuildable, loadImages, normalizeRegion, recipeProblem, saveImages } from '../../src/core/images/store.js';
import type { ImageRecipe, ImagesFile, Region } from '../../src/core/images/types.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';

afterAll(cleanupTempDirs);

const IMG = { width: 30, height: 10 };

test('빠진 값은 기본값으로, 영역은 그림 안으로 자른다', () => {
  const r = normalizeRegion({ rect: { x: -5, y: 0, w: 50, h: 20 } }, IMG);
  expect(r.rect).toEqual({ x: 0, y: 0, w: 30, h: 10 });
  expect(r).toMatchObject({
    erase: 'sample', text: '', fontPath: null, size: 24, color: '#ffffff', align: 'center', valign: 'middle',
    lineHeight: 1.25, bold: false, stroke: null, shadow: null,
  });
  expect(r.id).toMatch(/\S/);
  expect(normalizeRegion({ id: 'keep', rect: { x: 1, y: 1, w: 2, h: 2 } }, IMG).id).toBe('keep');
});

test('그림 밖 영역, 틀린 색, 범위 밖 크기', () => {
  expect(() => normalizeRegion({ rect: { x: 40, y: 0, w: 10, h: 5 } }, IMG)).toThrow('영역이 그림 밖에 있습니다');
  expect(() => normalizeRegion({ rect: { x: 0, y: 0, w: 5, h: 5 }, color: 'red' }, IMG)).toThrow('색 값이 올바르지 않습니다: red');
  expect(() => normalizeRegion({ rect: { x: 0, y: 0, w: 5, h: 5 }, erase: 'fill', fillColor: '#12' }, IMG)).toThrow('색 값이 올바르지 않습니다: #12');
  for (const c of ['#abc', '#a0b1c2', '#a0b1c2ff']) expect(normalizeRegion({ rect: { x: 0, y: 0, w: 5, h: 5 }, color: c }, IMG).color).toBe(c);
  expect(normalizeRegion({ rect: { x: 0, y: 0, w: 5, h: 5 }, size: 3 }, IMG).size).toBe(6);
  expect(normalizeRegion({ rect: { x: 0, y: 0, w: 5, h: 5 }, size: 9999 }, IMG).size).toBe(512);
});

function recipe(regions: Partial<Region>[], status: ImageRecipe['status'] = 'done'): ImageRecipe {
  return { file: 'img/pictures/a.png', baseHash: 'h1', status, regions: regions.map((r) => normalizeRegion({ rect: { x: 0, y: 0, w: 5, h: 5 }, ...r }, IMG)) };
}

test('recipeProblem: 원본이 바뀜, 폰트 없음, 글 없는 영역은 폰트가 필요 없다', () => {
  const has = (p: string) => p === 'C:/fonts/ok.ttf';
  expect(recipeProblem(recipe([{ text: '가', fontPath: 'C:/fonts/ok.ttf' }]), { hash: 'h2' }, has, null)).toBe('base-changed');
  expect(recipeProblem(recipe([{ text: '가', fontPath: 'C:/fonts/ok.ttf' }]), undefined, has, null)).toBe('base-changed');
  expect(recipeProblem(recipe([{ text: '가', fontPath: 'C:/fonts/ok.ttf' }]), { hash: 'h1' }, has, null)).toBeUndefined();
  expect(recipeProblem(recipe([{ text: '가', fontPath: 'C:/fonts/gone.ttf' }]), { hash: 'h1' }, has, null)).toBe('font-missing');
  expect(recipeProblem(recipe([{ text: '가' }]), { hash: 'h1' }, has, null)).toBe('font-missing');
  expect(recipeProblem(recipe([{ text: '가' }]), { hash: 'h1' }, has, 'C:/fonts/ok.ttf')).toBeUndefined();
  expect(recipeProblem(recipe([{ text: '' }, { text: '  ' }]), { hash: 'h1' }, () => false, null)).toBeUndefined();
});

test('isBuildable', () => {
  expect(isBuildable(recipe([], 'todo'), undefined)).toBe(false);
  expect(isBuildable(recipe([], 'done'), undefined)).toBe(true);
  expect(isBuildable(recipe([], 'done'), 'base-changed')).toBe(false);
  expect(isBuildable({ ...recipe([], 'manual'), manualFile: 'images/manual/a.png' }, undefined)).toBe(true);
  expect(isBuildable(recipe([], 'manual'), undefined)).toBe(false);
  expect(isBuildable(recipe([], 'skip'), undefined)).toBe(false);
});

test('저장하고 다시 읽으면 같다', async () => {
  const dir = await makeTempDir();
  expect(await loadImages(dir)).toEqual({ defaultFontPath: null, recipes: {} });
  const f: ImagesFile = { defaultFontPath: 'C:/fonts/ok.ttf', recipes: { 'img/pictures/a.png': recipe([{ text: '가', source: 'あ' }]) } };
  await saveImages(dir, f);
  expect(await loadImages(dir)).toEqual(f);
});
