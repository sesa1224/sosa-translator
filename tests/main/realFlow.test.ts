// Opt-in run of the whole flow (draft in the default 'balanced' mode: read the script, then merge) against the real, logged-in Claude CLI (spends real tokens):
//   MVMZ_REAL_CLI=1 npx vitest run tests/main/realFlow.test.ts
// Optional: MVMZ_REAL_FLOW_OUT=<file> writes the translations and per-call token use as JSON.
// Model: claude-haiku-5-5. Game: the test mini game plus a few lines written below.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { controlCodes } from '../../src/core/text/controlCodes.js';
import { hasJapanese } from '../../src/core/text/japanese.js';
import { findClaude } from '../../src/main/claude/chat.js';
import { runClaudeJson } from '../../src/main/claude/json.js';
import { ProjectService } from '../../src/main/projectService.js';
import { DraftJob } from '../../src/main/translate/draft.js';
import { TranslateJob } from '../../src/main/translate/job.js';
import { ReviewJob } from '../../src/main/translate/review.js';
import type { ChatUsage } from '../../src/shared/api.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';
import { makeMiniGame } from '../helpers/miniGame.js';

afterAll(() => cleanupTempDirs());

const MODEL = 'claude-haiku-5-5';
const MAX_INPUT_PER_CALL = 15000;

/** Extra messages: [speaker line or null, body lines]. Moans, sound effects, control codes, speaker lines. */
const EXTRA: [string | null, string[]][] = [
  ['【アーテル】', ['「あっ…んんっ♥　だめぇ…', 'そこ、くすぐったいってば…！」']],
  [null, ['ぐちゅぐちゅ…と湿った音が部屋に響いた。']],
  [null, ['\\C[2]月光草\\C[0]を\\V[1]本集めた。']],
  ['【アーテル】', ['「はぁ…はぁ…もう、イっちゃう…！」']],
  ['【ギア】', ['「ふん、ギルドの連中なんか信用できるか」']],
  ['【アーテル】', ['「ギア、\\N[1]を見なかった？」']],
  // Two characters of opposite temperament saying the same moan (per-character moan style).
  ['【シズク】', ['「あ、あの……すみません……', 'わ、私なんかが、お役に立てるかどうか……」']],
  ['【シズク】', ['「ご、ごめんなさい……', '声、出ちゃいそうで……恥ずかしい……」']],
  ['【レイナ】', ['「はあ？　私に指図するつもり？', '百年早いわよ、この雑魚！」']],
  ['【レイナ】', ['「ふん、こんなの全然平気なんだから！', '泣き言なんて言わないわよ！」']],
  ['【シズク】', ['「あっ…んんっ♥」']],
  ['【レイナ】', ['「あっ…んんっ♥」']],
];
export const SAME_MOAN = '「あっ…んんっ♥」';

async function addLines(game: string): Promise<void> {
  const file = path.join(game, 'data', 'Map001.json');
  const map = JSON.parse(await readFile(file, 'utf8'));
  const list: unknown[] = map.events[1].pages[0].list;
  const add: unknown[] = [];
  for (const [speaker, body] of EXTRA) {
    add.push({ code: 101, indent: 0, parameters: ['', 0, 0, 2] });
    for (const line of speaker ? [speaker, ...body] : body) add.push({ code: 401, indent: 0, parameters: [line] });
  }
  list.splice(list.length - 1, 0, ...add);
  await writeFile(file, JSON.stringify(map), 'utf8');
}

test.skipIf(!process.env.MVMZ_REAL_CLI)('실제 CLI 로 초안 → 확정 → 번역 → 검수', async () => {
  const command = findClaude(null);
  expect(command).not.toBeNull();
  const game = await makeTempDir();
  await makeMiniGame(game, { engine: 'MV' });
  await addLines(game);
  const svc = await ProjectService.create(game, path.join(await makeTempDir(), 'proj'), '약초원');

  const calls: { stage: string; ok: boolean; kind?: string; usage: ChatUsage; inputTotal: number }[] = [];
  let stage = '';
  const call = (async (o: Parameters<typeof runClaudeJson>[0]) => {
    const r = await runClaudeJson(o);
    const u = r.usage;
    calls.push({ stage, ok: r.ok, ...(r.ok ? {} : { kind: r.kind }), usage: u, inputTotal: u.input + u.cacheRead + u.cacheCreate });
    return r;
  }) as typeof runClaudeJson;
  const base = { svc, call, claude: { command: command! }, model: MODEL, cwd: svc.projectDir };

  stage = 'draft';
  const draft = new DraftJob({ ...base, mode: 'balanced' });
  await draft.start();
  expect(draft.progress.state).toBe('done');
  const g = svc.glossary();
  expect(g.terms.length).toBeGreaterThan(0);
  expect(g.characters.length).toBeGreaterThan(0);
  expect(g.rules.speakerPattern).not.toBeNull();
  await svc.confirmGlossary();

  stage = 'translate';
  const tj = new TranslateJob(base);
  await tj.start();
  const targets = svc.units().filter((u) => !u.needsDecision);
  const afterTranslate = targets.map((u) => ({ source: u.source, ...svc.entry(u.id) }));

  stage = 'review';
  const rj = new ReviewJob({ ...base, scope: { scope: 'all' } });
  if (tj.progress.state === 'done') await rj.start();

  // The report is written before the checks so a failing run still leaves its evidence.
  const report = {
    glossary: { terms: svc.glossary().terms, characters: svc.glossary().characters, speakerPattern: svc.glossary().rules.speakerPattern,
      gameStyle: svc.glossary().styleGuide.split('## 이 게임의 말투')[1]?.trim() ?? null },
    afterTranslate,
    afterReview: targets.map((u) => ({ source: u.source, ...svc.entry(u.id) })),
    calls,
    progress: { draft: draft.progress, translate: tj.progress, review: rj.progress },
  };
  if (process.env.MVMZ_REAL_FLOW_OUT) await writeFile(process.env.MVMZ_REAL_FLOW_OUT, JSON.stringify(report, null, 2), 'utf8');

  expect(tj.progress.state).toBe('done');
  for (const e of afterTranslate) expect(['needs-review', 'declined', 'error'], e.source).toContain(e.status);
  for (const u of targets) {
    const t = afterTranslate.find((x) => x.source === u.source)!.target;
    if (t === null) continue;
    expect(hasJapanese(t), `${u.source} → ${t}`).toBe(false);
    expect([...controlCodes(t)].sort(), `${u.source} → ${t}`).toEqual([...controlCodes(u.source)].sort());
  }
  const speakerUnit = targets.find((u) => u.source.startsWith('【アーテル】\n「あっ'))!;
  const spoken = afterTranslate.find((x) => x.source === speakerUnit.source)!.target!;
  expect(spoken.split('\n')[0]).toMatch(/^【[^【】]+】$/);
  expect(spoken.split('\n')[0]).not.toContain('アーテル');

  expect(rj.progress.state).toBe('done');
  for (const c of calls) expect(c.inputTotal, `${c.stage} 호출의 입력 토큰`).toBeLessThan(MAX_INPUT_PER_CALL);
  await svc.close();
}, 30 * 60 * 1000);
