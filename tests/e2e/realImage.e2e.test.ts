// Opt-in: the real, logged-in Claude CLI translates the words of one picture through the app's chat (spends real tokens).
//   npm run build:app && MVMZ_REAL_CLI=1 npx vitest run -c vitest.e2e.config.ts tests/e2e/realImage.e2e.test.ts
// Optional: MVMZ_REAL_CLI_MODEL (default claude-haiku-5-5), MVMZ_REAL_OUT_DIR (where the pictures and the log go),
// MVMZ_REAL_JP_FONT / MVMZ_REAL_KO_FONT (fonts for the test picture and the translation).
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright-core';
import { afterAll, expect, test } from 'vitest';
import { findClaude } from '../../src/main/claude/chat.js';
import { makeMiniGame } from '../helpers/miniGame.js';
import { makePng } from '../helpers/png.js';

const FONTS = process.env.WINDIR ? path.join(process.env.WINDIR, 'Fonts') : 'C:\\Windows\\Fonts';
const JP = process.env.MVMZ_REAL_JP_FONT ?? path.join(FONTS, 'NotoSansJP-VF.ttf');
const KO = process.env.MVMZ_REAL_KO_FONT ?? path.join(FONTS, 'NotoSansKR-VF.ttf');
let tmp = '';
afterAll(async () => { if (tmp) await rm(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }); });

const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
const region = (y: number, text: string) => ({
  id: `src${y}`, rect: { x: 40, y, w: 400, h: 60 }, erase: 'none', text, fontPath: JP, size: 40, color: '#ffffff',
  align: 'center', valign: 'middle', lineHeight: 1.25, bold: false, stroke: null, shadow: null,
});

test.skipIf(!process.env.MVMZ_REAL_CLI)('실제 CLI 가 채팅 한 번으로 그림 한 장의 지시서를 쓴다', async () => {
  const claude = findClaude(null);
  expect(claude).not.toBeNull();
  expect(existsSync(JP) && existsSync(KO)).toBe(true);
  tmp = await mkdtemp(path.join(os.tmpdir(), 'mvmz-real-image-'));
  const out = process.env.MVMZ_REAL_OUT_DIR ?? tmp;
  await mkdir(out, { recursive: true });
  const userData = path.join(tmp, 'userData');
  const projectsDir = path.join(tmp, 'projects');
  const game = path.join(tmp, 'game');
  await mkdir(userData, { recursive: true });
  await makeMiniGame(game);
  await writeFile(path.join(userData, 'settings.json'), JSON.stringify({ projectsDir, chatModel: process.env.MVMZ_REAL_CLI_MODEL ?? 'claude-haiku-5-5', claudePath: claude }), 'utf8');

  const app = await electron.launch({ args: ['.'], env: { ...process.env, MVMZ_USER_DATA: userData, MVMZ_PICK_DIR: game, MVMZ_TEST_HOOKS: '1' } as Record<string, string> });
  try {
    const w = await app.firstWindow();
    // The test picture: two Japanese lines on a dark background, drawn by the app's own render window.
    const picture = Buffer.from(await app.evaluate(async (_e, a) => {
      const svc = (globalThis as any).__mvmzTest.render;
      const png: Uint8Array = await svc.render({ base: new Uint8Array(Buffer.from(a.base, 'base64')), regions: a.regions, fonts: { [a.jp]: new Uint8Array(Buffer.from(a.font, 'base64')) }, defaultFontPath: null });
      return Buffer.from(png).toString('base64');
    }, { base: b64(makePng(480, 200, [24, 28, 48, 255])), regions: [region(30, 'はじめから'), region(110, 'つづきから')], jp: JP, font: b64(await readFile(JP)) }), 'base64');
    const file = 'img/pictures/title_menu.png';
    await writeFile(path.join(game, ...file.split('/')), picture);
    await writeFile(path.join(out, 'plan7-real-original.png'), picture);

    await w.getByRole('button', { name: '게임 폴더 고르기' }).click(); await w.getByLabel('프로젝트 이름').fill('그림'); await w.getByRole('button', { name: '만들기' }).click();
    await w.getByRole('navigation', { name: '작업 메뉴' }).waitFor();
    await w.evaluate(async (ko) => {
      await (window as any).api.fonts.list();
      await (window as any).api.images.setDefaultFont(ko);
      (window as any).__events = [];
      (window as any).api.on('chat:event', (e: unknown) => (window as any).__events.push(e));
    }, KO);

    await w.getByRole('tab', { name: '채팅' }).click();
    await w.getByLabel('메시지').fill('이 게임의 그림 속 글자를 번역해줘');
    await w.getByLabel('메시지').press('Enter');
    let events: any[] = [];
    for (let i = 0; i < 560; i++) {
      events = await w.evaluate(() => (window as any).__events);
      if (events.some((e) => e.type === 'turn-end' || e.type === 'error')) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    const tools = events.filter((e) => e.type === 'tool-start').map((e) => ({ name: e.name, input: e.input }));
    const end = events.find((e) => e.type === 'turn-end' || e.type === 'error');
    const answer = events.filter((e) => e.type === 'text').map((e) => e.text).join('\n');
    const recipe = await w.evaluate(async (f) => (window as any).api.images.recipe(f), file);
    let result: Buffer | null = null;
    try {
      const r = await w.evaluate(async (f) => { const b = await (window as any).api.images.full(f, 'rendered'); return b ? Array.from(b as Uint8Array) : null; }, file);
      result = r ? Buffer.from(r) : null;
    } catch {
      result = null;
    }
    if (result) {
      await writeFile(path.join(out, 'plan7-real-result.png'), result);
      const side = await app.evaluate(async (_e, a) => {
        const svc = (globalThis as any).__mvmzTest.render;
        const cells = [{ label: '원본', png: new Uint8Array(Buffer.from(a.o, 'base64')) }, { label: '결과', png: new Uint8Array(Buffer.from(a.r, 'base64')) }];
        return Buffer.from(await svc.sheet({ cells, columns: 2, cellSize: 520 })).toString('base64');
      }, { o: b64(picture), r: b64(result) });
      await writeFile(path.join(out, 'plan7-real-side-by-side.png'), Buffer.from(side, 'base64'));
    }
    const log = { model: process.env.MVMZ_REAL_CLI_MODEL ?? 'claude-haiku-5-5', tools, recipe, answer, end };
    await writeFile(path.join(out, 'plan7-real-chat.json'), JSON.stringify(log, null, 2), 'utf8');
    console.log(JSON.stringify({ tools: tools.map((t) => t.name), regions: recipe?.regions?.map((r: any) => ({ rect: r.rect, text: r.text, source: r.source })), status: recipe?.status, end }, null, 2));

    expect(end).toMatchObject({ type: 'turn-end', ok: true });
    expect(tools.some((t) => t.name === 'image_set_recipe')).toBe(true);
    expect(recipe?.regions?.length ?? 0).toBeGreaterThan(0);
  } finally {
    await app.close();
  }
}, 600000);
