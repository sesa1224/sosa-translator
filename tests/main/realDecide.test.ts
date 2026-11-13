// Opt-in check of the decide job against the real, logged-in Claude CLI (spends real tokens):
//   MVMZ_REAL_CLI=1 npx vitest run tests/main/realDecide.test.ts
// Uses the test-only mini game and claude-haiku-5-5. Never reads a real game folder.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { findClaude } from '../../src/main/claude/chat.js';
import { runClaudeJson } from '../../src/main/claude/json.js';
import { ProjectService } from '../../src/main/projectService.js';
import { DecideJob } from '../../src/main/translate/decide.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';
import { makeMiniGame } from '../helpers/miniGame.js';

afterAll(() => cleanupTempDirs());

const DISPLAY = 'addLog アーテルは\\C[5]ギア\\C[0]を訓練に誘った';
const FILE = 'PictureShow 立ち絵 1 0 0';
const SCRIPT = '$gameMessage.add("おっぱい弄られた回数：\\\\V[81]")';

test.skipIf(!process.env.MVMZ_REAL_CLI)('실제 CLI 로 판단 필요 묶음 추천', async () => {
  const command = findClaude(null);
  expect(command).not.toBeNull();
  const game = await makeTempDir();
  await makeMiniGame(game);
  const mapFile = path.join(game, 'data', 'Map001.json');
  const map = JSON.parse(await readFile(mapFile, 'utf8'));
  const list: unknown[] = map.events[1].pages[0].list;
  list.splice(list.length - 1, 0,
    { code: 356, indent: 0, parameters: [DISPLAY] },
    { code: 356, indent: 0, parameters: [FILE] },
    { code: 355, indent: 0, parameters: [SCRIPT] });
  await writeFile(mapFile, JSON.stringify(map), 'utf8');
  const svc = await ProjectService.create(game, path.join(await makeTempDir(), 'proj'), '실제 판단');
  try {
    // Only the three groups under test go to the model.
    const keyOf = (source: string) => svc.units().find((u) => u.source === source)!.decisionKey!;
    const wanted = new Set([keyOf(DISPLAY), keyOf(FILE), keyOf(SCRIPT)]);
    for (const g of svc.decisionGroups()) {
      if (!wanted.has(g.key)) await svc.setDecision(g.key, { translate: false, keep: { mode: 'whole' } }, 'user');
    }
    const job = new DecideJob({ svc, call: runClaudeJson, claude: { command: command! }, model: 'claude-haiku-5-5', cwd: await makeTempDir() });
    await job.start();
    const d = svc.decisions();
    const report = [...wanted].map((k) => ({ key: k, decision: d[k] ?? null }));
    console.log('[realDecide] progress', JSON.stringify(job.progress));
    console.log('[realDecide] decisions', JSON.stringify(report, null, 2));
    expect(job.progress.state).toBe('done');
    expect(d[keyOf(DISPLAY)]).toMatchObject({ translate: true, by: 'claude', status: 'suggested' });
    expect(d[keyOf(FILE)]).toMatchObject({ translate: false, by: 'claude', status: 'suggested' });
    expect(d[keyOf(SCRIPT)]).toMatchObject({ by: 'claude', status: 'suggested' });
  } finally {
    await svc.close();
  }
}, 300000);
