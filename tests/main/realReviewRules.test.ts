// Opt-in check against the real, logged-in Claude CLI (spends real tokens):
//   MVMZ_REAL_CLI=1 npx vitest run tests/main/realReviewRules.test.ts
// The default review text must not flag half-width punctuation, a form of address from the character card,
// or a kept genre interjection, and must still flag a dropped mark and hard-to-read translationese.
import { afterAll, expect, test } from 'vitest';
import { defaultGlossary, termId } from '../../src/core/glossary/store.js';
import type { Glossary } from '../../src/core/glossary/types.js';
import { findClaude } from '../../src/main/claude/chat.js';
import { runClaudeJson } from '../../src/main/claude/json.js';
import { buildReviewPrompt, isReviewAnswer, REVIEW_SCHEMA, type ReviewItem } from '../../src/main/translate/review.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';

afterAll(() => cleanupTempDirs());

const glossary: Glossary = {
  ...defaultGlossary(),
  terms: [
    { id: termId('先生'), source: '先生', target: '선생', category: 'name', status: 'confirmed', candidates: [], scope: 'speaker' },
    { id: termId('ドン'), source: 'ドン', target: '돈', category: 'name', status: 'confirmed', candidates: [] },
  ],
  characters: [{ id: 'don', source: 'ドン', target: '돈', speech: '공손한 존댓말', addressing: '아텔 선생님/선생님' }],
};
const line = (i: number, speaker: string | null, source: string, target: string): ReviewItem =>
  ({ i, id: String(i), kind: 'dialogue', speaker, speakerLine: speaker ? `【${speaker}】` : null, source, target });
const items = [
  line(0, null, '「知ってた？」', '「알고 있었어?」'),
  line(1, null, '（何の匂い・・？）', '（무슨 냄새지……?）'),
  line(2, null, '「！？」', '「!?」'),
  line(3, null, '「えっ！？」', '「어!」'),
  line(4, 'ドン', '「先生、もう帰りましょう」', '「선생님, 이제 돌아가요」'),
  line(5, null, '「おいおい、どうした？」', '「어이어이, 왜 그래?」'),
  line(6, null, '「潮吹きしちゃった…」', '「시오후키 해버렸어……」'),
  line(7, null, '「中に出されちゃった…」', '「안에 싸져 버렸어……」'),
];
const CLEAN = [0, 1, 2, 4, 5];
const FLAGGED = [3, 6, 7];

test.skipIf(!process.env.MVMZ_REAL_CLI)('검수가 반각·호칭·남기는 말투는 넘기고 번역투와 빠진 기호는 잡는다', async () => {
  const command = findClaude(null);
  expect(command).not.toBeNull();
  const prompt = buildReviewPrompt({ label: 'x', file: 'f', items }, glossary);
  const r = await runClaudeJson({
    command: command!, cwd: await makeTempDir(), model: process.env.MVMZ_REAL_MODEL ?? 'claude-haiku-5-5',
    system: prompt.system, user: prompt.user, schema: REVIEW_SCHEMA, validate: isReviewAnswer,
  });
  console.log('[realReviewRules]', JSON.stringify(r, null, 1));
  expect(r.ok).toBe(true);
  const hit = new Set((r as any).data.problems.map((p: { i: number }) => p.i));
  expect(CLEAN.filter((i) => hit.has(i))).toEqual([]);
  expect(FLAGGED.filter((i) => !hit.has(i))).toEqual([]);
}, 300000);
