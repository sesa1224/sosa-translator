// Opt-in check against the real, logged-in Claude CLI (spends real tokens):
//   MVMZ_REAL_CLI=1 npx vitest run tests/main/realEventPatch.test.ts   (run `npm run build:app` first)
// Optional: MVMZ_REAL_CLI_MODEL (default claude-haiku-5-5), MVMZ_REAL_EVENT_OUT (tools, patch and tokens as JSON).
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { afterAll, expect, test } from 'vitest';
import { startBridge, writeMcpConfig } from '../../src/main/bridge.js';
import { buildClaudeArgs } from '../../src/main/claude/args.js';
import { findClaude } from '../../src/main/claude/chat.js';
import { buildSystemPrompt } from '../../src/main/claude/prompt.js';
import { StreamParser, userMessageLine } from '../../src/main/claude/stream.js';
import { ProjectService } from '../../src/main/projectService.js';
import { computeStats, toRow } from '../../src/shared/rows.js';
import type { ChatEvent, ChatUsage } from '../../src/shared/api.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';
import { freshGame } from './helpers.js';

const root = path.resolve(__dirname, '../..');
afterAll(async () => { await cleanupTempDirs(); });

/** Event 1 never turns switch 45 on, and event 2 waits for it: the bug the chat should fix. */
async function brokenGame(game: string): Promise<void> {
  const mapFile = path.join(game, 'data', 'Map001.json');
  const map = JSON.parse(await readFile(mapFile, 'utf8'));
  map.events.push({ id: 2, name: 'EV002', x: 5, y: 5, pages: [{
    conditions: { switch1Valid: true, switch1Id: 45, switch2Valid: false, switch2Id: 1, variableValid: false, variableId: 1, variableValue: 0, selfSwitchValid: false, selfSwitchCh: 'A', itemValid: false, itemId: 1, actorValid: false, actorId: 1 },
    trigger: 3,
    list: [
      { code: 101, indent: 0, parameters: ['', 0, 0, 2, 'リナ'] },
      { code: 401, indent: 0, parameters: ['待ってたよ'] },
      { code: 0, indent: 0, parameters: [] },
    ],
  }] });
  await writeFile(mapFile, JSON.stringify(map));
  const sysFile = path.join(game, 'data', 'System.json');
  const sys = JSON.parse(await readFile(sysFile, 'utf8'));
  sys.switches = [];
  sys.switches[45] = '이벤트1 끝남';
  await writeFile(sysFile, JSON.stringify(sys));
}

test.skipIf(!process.env.MVMZ_REAL_CLI)('실제 Claude CLI 가 사용처를 찾고 event_patch 로 스위치를 켜는 줄을 넣는다', async () => {
  const claude = findClaude(null);
  expect(claude).not.toBeNull();
  const { game, proj } = await freshGame();
  await brokenGame(game);
  const svc = await ProjectService.create(game, proj, '약초원');
  const bridge = await startBridge(() => svc);
  const work = await makeTempDir();
  const mcp = await writeMcpConfig(work, bridge, path.join(root, 'out/main/mcp-server.js'), process.execPath);
  const stats = computeStats(svc.units().map((u) => toRow(u, svc.entry(u.id))));
  const model = process.env.MVMZ_REAL_CLI_MODEL ?? 'claude-haiku-5-5';
  const args = buildClaudeArgs({ model, mcpConfigPath: mcp, systemPrompt: buildSystemPrompt(svc.meta, stats) });

  const child = spawn(claude!, args, { cwd: work, windowsHide: true, stdio: 'pipe' });
  const parser = new StreamParser();
  const events: ChatEvent[] = [];
  let stderr = '';
  child.stderr.on('data', (d) => { stderr += d; });
  const done = new Promise<void>((resolve, reject) => {
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (d: string) => {
      for (const ev of parser.push(d)) {
        events.push(ev);
        if (ev.type === 'turn-end') resolve();
      }
    });
    child.on('close', (code) => reject(new Error(`claude exited ${code}: ${stderr.slice(-500)}`)));
  });
  child.stdin.write(userMessageLine('이벤트1이 끝나도 이벤트2로 안 넘어가. 고쳐줘', []));
  try {
    await done;
  } finally {
    child.stdin.end();
    child.kill();
    await bridge.close();
  }

  const tools = events.filter((e): e is Extract<ChatEvent, { type: 'tool-start' }> => e.type === 'tool-start').map((e) => ({ name: e.name, input: e.input }));
  const ends = events.filter((e): e is Extract<ChatEvent, { type: 'tool-end' }> => e.type === 'tool-end').map((e) => ({ isError: e.isError, summary: e.summary }));
  const turn = events.at(-1) as Extract<ChatEvent, { type: 'turn-end' }>;
  const usage: ChatUsage = turn.usage;
  const answer = events.filter((e): e is Extract<ChatEvent, { type: 'text' }> => e.type === 'text').map((e) => e.text).join('\n');
  const patches = svc.patches();
  let built: unknown = null;
  if (patches.length > 0) {
    const r = await svc.build();
    const zip = unzipSync(await readFile(r.zipPath));
    built = JSON.parse(strFromU8(zip['data/Map001.json'])).events[1].pages[0].list;
  }
  const report = { model, tools, ends, patches, usage, answer, builtEvent1: built };
  console.log(JSON.stringify(report, null, 2));
  if (process.env.MVMZ_REAL_EVENT_OUT) await writeFile(process.env.MVMZ_REAL_EVENT_OUT, JSON.stringify(report, null, 2), 'utf8');

  expect(turn).toMatchObject({ type: 'turn-end', ok: true });
  expect(tools.some((t) => t.name === 'usage_search' || t.name === 'event_read')).toBe(true);
  expect(tools.some((t) => t.name === 'event_patch')).toBe(true);
  const patch = patches.find((p) => p.body.kind === 'event');
  expect(patch).toMatchObject({ createdBy: 'claude', body: { file: 'data/Map001.json', listPath: ['events', 1, 'pages', 0, 'list'] } });
  const inserted = patch!.body.kind === 'event' ? patch!.body.ops.flatMap((o) => (o.op === 'delete' ? [] : o.commands)) : [];
  expect(inserted).toContainEqual(expect.objectContaining({ code: 121, parameters: [45, 45, 0] }));
  expect(built).toEqual(expect.arrayContaining([expect.objectContaining({ code: 121, parameters: [45, 45, 0] })]));
  await svc.close();
}, 300000);
