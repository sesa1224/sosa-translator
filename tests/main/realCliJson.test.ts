// Opt-in check against the real, logged-in Claude CLI (spends real tokens):
//   MVMZ_REAL_CLI=1 npx vitest run tests/main/realCliJson.test.ts
import { afterAll, expect, test } from 'vitest';
import { findClaude } from '../../src/main/claude/chat.js';
import { runClaudeJson } from '../../src/main/claude/json.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';

afterAll(() => cleanupTempDirs());

interface Items { items: { i: number; t: string }[] }
const isItems = (v: unknown): v is Items => !!v && typeof v === 'object' && Array.isArray((v as any).items)
  && (v as any).items.every((x: any) => typeof x?.i === 'number' && typeof x?.t === 'string');
const itemsSchema = { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { i: { type: 'integer' }, t: { type: 'string' } }, required: ['i', 't'] } } }, required: ['items'] };

test.skipIf(!process.env.MVMZ_REAL_CLI)('실제 CLI 가 스키마대로 답한다', async () => {
  const command = findClaude(null);
  expect(command).not.toBeNull();
  const real = { command: command!, cwd: await makeTempDir(), model: 'claude-haiku-5-5' };
  const r = await runClaudeJson({ ...real, system: '입력 JSON의 text를 한국어로 번역해 items로 돌려준다.', user: JSON.stringify([{ i: 0, text: 'おはよう' }]), schema: itemsSchema, validate: isItems });
  console.log('[realCliJson]', JSON.stringify(r));
  expect(r.ok).toBe(true); expect((r as any).data.items[0].i).toBe(0);
}, 180000);
