// Opt-in check that a picture in a tool result reaches the model (spends real tokens):
//   MVMZ_REAL_CLI=1 npx vitest run tests/main/realImageTool.test.ts
// Optional: MVMZ_REAL_CLI_MODEL (default claude-haiku-5-5), MVMZ_REAL_CLI_OUT (raw stdout copy).
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { detectGame } from '../../src/core/engine/detect.js';
import { startBridge, writeMcpConfig } from '../../src/main/bridge.js';
import { buildClaudeArgs } from '../../src/main/claude/args.js';
import { findClaude } from '../../src/main/claude/chat.js';
import { buildSystemPrompt } from '../../src/main/claude/prompt.js';
import { StreamParser, userMessageLine } from '../../src/main/claude/stream.js';
import { ImageService } from '../../src/main/images.js';
import { ProjectService } from '../../src/main/projectService.js';
import type { ChatEvent } from '../../src/shared/api.js';
import { computeStats, toRow } from '../../src/shared/rows.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';
import { makeMiniGame } from '../helpers/miniGame.js';
import { makePng } from '../helpers/png.js';

const root = path.resolve(__dirname, '../..');
const outDir = path.join(root, 'node_modules/.cache/mvmz-real-image-test');
afterAll(async () => { await cleanupTempDirs(); });

test.skipIf(!process.env.MVMZ_REAL_CLI)('도구 결과의 그림이 실제 모델에게 보인다', async () => {
  const claude = findClaude(null);
  expect(claude).not.toBeNull();
  execFileSync(process.execPath, [path.join(root, 'node_modules/electron-vite/bin/electron-vite.js'), 'build', '--outDir', outDir], { cwd: root, stdio: 'ignore' });

  // Dark blue picture with three white squares (a guess of "1" would fail).
  const game = await makeTempDir();
  await makeMiniGame(game);
  await rm(path.join(game, 'img'), { recursive: true, force: true });
  await mkdir(path.join(game, 'img', 'pictures'), { recursive: true });
  const white = (x: number, y: number) => [30, 160, 290].some((l) => x >= l && x < l + 80) && y >= 110 && y < 190;
  await writeFile(path.join(game, 'img', 'pictures', 'box.png'), makePng(400, 300, (x, y) => (white(x, y) ? [255, 255, 255, 255] : [20, 30, 90, 255])));
  const svc = await ProjectService.create(game, path.join(await makeTempDir(), 'proj'), '약초원');
  // Small picture: no shrinking needed, so no render window is needed either.
  new ImageService({ svc, game: await detectGame(game), render: { render: async () => new Uint8Array(), sheet: async () => new Uint8Array(), thumbnail: async (png) => png } });
  const bridge = await startBridge(() => svc);
  const work = await makeTempDir();
  const mcp = await writeMcpConfig(work, bridge, path.join(outDir, 'main/mcp-server.js'), process.execPath);
  const stats = computeStats(svc.units().map((u) => toRow(u, svc.entry(u.id))));
  const args = buildClaudeArgs({ model: process.env.MVMZ_REAL_CLI_MODEL ?? 'claude-haiku-5-5', mcpConfigPath: mcp, systemPrompt: buildSystemPrompt(svc.meta, stats) });

  const child = spawn(claude!, args, { cwd: work, windowsHide: true, stdio: 'pipe' });
  const parser = new StreamParser();
  const events: ChatEvent[] = [];
  let raw = '';
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  const done = new Promise<void>((resolve, reject) => {
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d: string) => {
      raw += d;
      for (const ev of parser.push(d)) {
        events.push(ev);
        if (ev.type === 'turn-end') resolve();
      }
    });
    child.on('close', (code) => reject(new Error(`claude exited ${code}: ${stderr.slice(-500)}`)));
  });
  child.stdin.write(userMessageLine('image_view 도구로 img/pictures/box.png 를 보고 답해줘. 이 그림에 흰 네모가 몇 개 보여? 아라비아 숫자 하나로만 답해. 그림이 안 보이면 "안 보임"이라고 답해.', []));
  try {
    await done;
  } finally {
    child.stdin.end();
    child.kill();
    if (process.env.MVMZ_REAL_CLI_OUT) await writeFile(process.env.MVMZ_REAL_CLI_OUT, raw, 'utf8');
    await bridge.close();
  }

  const lines = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const results = lines.filter((l) => l.type === 'user').flatMap((l) => (Array.isArray(l.message?.content) ? l.message.content : [])).filter((b: any) => b?.type === 'tool_result');
  const blockTypes = results.map((r: any) => (Array.isArray(r.content) ? r.content.map((c: any) => c.type) : [typeof r.content]));
  const answer = events.filter((e): e is Extract<ChatEvent, { type: 'text' }> => e.type === 'text').map((e) => e.text).join('');
  const end = events.at(-1);
  console.log('tools:', events.filter((e) => e.type === 'tool-start').map((e) => (e as any).name), '\ntool_result blocks:', JSON.stringify(blockTypes), '\nanswer:', answer, '\nturn-end:', JSON.stringify(end));

  expect(events.some((e) => e.type === 'tool-start' && e.name === 'image_view')).toBe(true);
  expect(end).toMatchObject({ type: 'turn-end', ok: true });
  expect(answer).not.toContain('안 보임');
  expect(answer.replace(/\s/g, '')).toMatch(/(^|[^0-9])3([^0-9]|$)/);
  await svc.close();
}, 300000);
