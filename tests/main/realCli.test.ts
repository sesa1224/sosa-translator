// Opt-in check against the real, logged-in Claude CLI (spends real tokens):
//   MVMZ_REAL_CLI=1 npx vitest run tests/main/realCli.test.ts
// Optional: MVMZ_REAL_CLI_MODEL (default claude-haiku-5-5), MVMZ_REAL_CLI_OUT (raw stdout copy).
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { startBridge, writeMcpConfig } from '../../src/main/bridge.js';
import { buildClaudeArgs } from '../../src/main/claude/args.js';
import { findClaude } from '../../src/main/claude/chat.js';
import { buildSystemPrompt } from '../../src/main/claude/prompt.js';
import { StreamParser, userMessageLine } from '../../src/main/claude/stream.js';
import { ProjectService } from '../../src/main/projectService.js';
import { computeStats, toRow } from '../../src/shared/rows.js';
import type { ChatEvent } from '../../src/shared/api.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';
import { freshGame } from './helpers.js';

const root = path.resolve(__dirname, '../..');
afterAll(async () => { await cleanupTempDirs(); });

test.skipIf(!process.env.MVMZ_REAL_CLI)('실제 Claude CLI 가 mvmz 도구로 번역표를 고친다', async () => {
  const claude = findClaude(null);
  expect(claude).not.toBeNull();
  const { game, proj } = await freshGame();
  const svc = await ProjectService.create(game, proj, '약초원');
  const bridge = await startBridge(() => svc);
  const work = await makeTempDir();
  const mcp = await writeMcpConfig(work, bridge, path.join(root, 'out/main/mcp-server.js'), process.execPath);
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
  child.stdin.write(userMessageLine("月光草 를 찾아서 '월광초'로 번역해줘", []));
  try {
    await done;
  } finally {
    child.stdin.end();
    child.kill();
    if (process.env.MVMZ_REAL_CLI_OUT) await writeFile(process.env.MVMZ_REAL_CLI_OUT, raw, 'utf8');
    await bridge.close();
  }

  const lines = raw.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const init = lines.find((l) => l.type === 'system' && l.subtype === 'init');
  const builtIn = (init?.tools as string[]).filter((t) => !t.startsWith('mcp__'));
  console.log('init tools:', init?.tools, '\nline types:', [...new Set(lines.map((l) => `${l.type}${l.subtype ? '/' + l.subtype : ''}${l.event?.type ? '/' + l.event.type : ''}`))],
    '\nevents:', events.map((e) => e.type), '\nturn-end:', events.at(-1));

  expect(events[0]).toMatchObject({ type: 'session' });
  expect(builtIn).toEqual([]);
  expect(events.some((e) => e.type === 'tool-start' && e.name === 'set_translation')).toBe(true);
  expect(events.some((e) => e.type === 'text-delta')).toBe(true);
  expect(events.at(-1)).toMatchObject({ type: 'turn-end', ok: true });
  const id = svc.units().find((u) => u.source === '月光草')!.id;
  expect(svc.entry(id).target).toBe('월광초');
  await svc.close();
}, 300000);
