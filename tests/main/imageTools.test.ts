import { execFileSync } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { detectGame } from '../../src/core/engine/detect.js';
import { startBridge } from '../../src/main/bridge.js';
import { buildClaudeArgs, CHAT_TOOLS } from '../../src/main/claude/args.js';
import { buildSystemPrompt } from '../../src/main/claude/prompt.js';
import { ImageService } from '../../src/main/images.js';
import { ProjectService } from '../../src/main/projectService.js';
import type { RenderJob, SheetJob } from '../../src/main/render/renderService.js';
import { callTool } from '../../src/main/toolHandlers.js';
import { computeStats } from '../../src/shared/rows.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';
import { makeMiniGame } from '../helpers/miniGame.js';
import { makePng } from '../helpers/png.js';

const root = path.resolve(__dirname, '../..');
// Own build folder: bridge.test.ts builds into out/ at the same time.
const outDir = path.join(root, 'node_modules/.cache/mvmz-image-tools-test');
const builtServerPath = path.join(outDir, 'main/mcp-server.js');
const SHEET = makePng(3, 3, [1, 2, 3, 255]);
const FONT = 'C:/fonts/ok.ttf';

let svc: ProjectService;
let images: ImageService;
let bridge: Awaited<ReturnType<typeof startBridge>>;
let client: Client;

beforeAll(async () => {
  execFileSync(process.execPath, [path.join(root, 'node_modules/electron-vite/bin/electron-vite.js'), 'build', '--outDir', outDir], { cwd: root, stdio: 'ignore' });
  const game = await makeTempDir();
  await makeMiniGame(game);
  await rm(path.join(game, 'img'), { recursive: true, force: true });
  await mkdir(path.join(game, 'img', 'pictures'), { recursive: true });
  await writeFile(path.join(game, 'img', 'pictures', 'menu.png'), makePng(200, 100, [10, 10, 10, 255]));
  await writeFile(path.join(game, 'img', 'pictures', 'logo.png'), makePng(40, 40, [200, 10, 10, 255]));
  svc = await ProjectService.create(game, path.join(await makeTempDir(), 'proj'), '약초원');
  images = new ImageService({
    svc, game: await detectGame(game), fontExists: (p) => p === FONT, readFont: async () => Uint8Array.from([1]),
    render: {
      render: async (_j: RenderJob) => SHEET,
      sheet: async (_j: SheetJob) => SHEET,
      thumbnail: async (png: Uint8Array) => png,
    },
  });
  images.knownFonts = () => [FONT];
  bridge = await startBridge(() => svc);
  client = new Client({ name: 'image-tools-test', version: '0.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [builtServerPath], env: { MVMZ_BRIDGE_URL: bridge.url, MVMZ_BRIDGE_TOKEN: bridge.token }, stderr: 'pipe' }));
}, 120000);
afterAll(async () => {
  await client?.close();
  await bridge?.close();
  await svc?.close();
  await cleanupTempDirs();
});

test('image_sheet 는 모음판 그림 한 장과 번호 붙은 목록을 준다', async () => {
  const r = await callTool(svc, 'image_sheet', {});
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.images).toHaveLength(1);
  expect(r.images![0].mediaType).toBe('image/png');
  expect(Buffer.from(r.images![0].base64, 'base64')).toEqual(Buffer.from(SHEET));
  expect((r.data as any).items).toEqual([
    expect.objectContaining({ n: 1, file: 'img/pictures/logo.png' }),
    expect.objectContaining({ n: 2, file: 'img/pictures/menu.png' }),
  ]);
  expect((r.data as any).pages).toBe(1);
});

test('MCP 로 부르면 글 블록 다음에 그림 블록, 기존 도구는 글 블록 하나', async () => {
  const v = await client.callTool({ name: 'image_view', arguments: { file: 'img/pictures/menu.png' } });
  const content = v.content as any[];
  expect(content.map((c) => c.type)).toEqual(['text', 'image']);
  expect(content[1].mimeType).toBe('image/png');
  expect(JSON.parse(content[0].text)).toMatchObject({ width: 200, height: 100, scale: 1 });
  const s = await client.callTool({ name: 'project_status', arguments: {} });
  expect((s.content as any[]).map((c) => c.type)).toEqual(['text']);
});

test('image_set_recipe: 그림 밖 영역은 오류, 정상이면 저장하고 done 이면 끝남', async () => {
  const bad = await callTool(svc, 'image_set_recipe', { file: 'img/pictures/menu.png', regions: [{ rect: { x: 500, y: 0, w: 10, h: 10 } }] });
  expect(bad).toEqual({ ok: false, error: '영역이 그림 밖에 있습니다' });
  const ok = await callTool(svc, 'image_set_recipe', {
    file: 'img/pictures/menu.png', done: true,
    regions: [{ rect: { x: 10, y: 10, w: 100, h: 30 }, erase: 'fill', fillColor: '#000000', text: '메뉴', source: 'メニュー', size: 20 }],
  });
  expect(ok.ok).toBe(true);
  expect(images.recipe('img/pictures/menu.png')).toMatchObject({ status: 'done', regions: [{ text: '메뉴', source: 'メニュー', rect: { x: 10, y: 10, w: 100, h: 30 } }] });
  expect((ok as any).data).toMatchObject({ status: 'done', regions: [expect.objectContaining({ text: '메뉴' })] });
  await callTool(svc, 'image_set_recipe', { file: 'img/pictures/menu.png', regions: [{ rect: { x: 10, y: 10, w: 100, h: 30 }, text: '메뉴' }] });
  expect(images.recipe('img/pictures/menu.png')?.status).toBe('done');
});

test('image_set_recipe: 목록에 없는 폰트 경로는 무시하고 null 로 저장', async () => {
  await callTool(svc, 'image_set_recipe', { file: 'img/pictures/logo.png', regions: [{ rect: { x: 0, y: 0, w: 10, h: 10 }, text: '가', fontPath: 'C:/made/up.ttf' }] });
  expect(images.recipe('img/pictures/logo.png')?.regions[0].fontPath).toBeNull();
  await callTool(svc, 'image_set_recipe', { file: 'img/pictures/logo.png', regions: [{ rect: { x: 0, y: 0, w: 10, h: 10 }, text: '가', fontPath: FONT }] });
  expect(images.recipe('img/pictures/logo.png')?.regions[0].fontPath).toBe(FONT);
});

test('image_set_status 와 image_list', async () => {
  expect((await callTool(svc, 'image_set_status', { file: 'img/pictures/logo.png', status: 'skip' })).ok).toBe(true);
  const r = await callTool(svc, 'image_list', { status: 'skip' });
  expect(r.ok && (r.data as any).items.map((i: any) => i.file)).toEqual(['img/pictures/logo.png']);
  expect(r.ok && r.images).toBeUndefined();
});

test('채팅 도구 목록과 시스템 프롬프트에 그림 도구가 들어 있다', () => {
  for (const t of ['image_sheet', 'image_view', 'image_set_recipe', 'image_set_status', 'image_list']) expect(CHAT_TOOLS).toContain(t);
  expect(buildClaudeArgs({ model: 'm', mcpConfigPath: 'p', systemPrompt: 'S' }).join(' ')).toContain('mcp__mvmz__image_set_recipe');
  const p = buildSystemPrompt(svc.meta, computeStats([]));
  expect(p).toContain('image_sheet 로 모음판을 보고');
  expect(p).toContain('fontPath 를 지어내지 않는다');
});
