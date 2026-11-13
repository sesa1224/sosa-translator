import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, expect, test } from 'vitest';
import { runClaudeJson } from '../../src/main/claude/json.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';

const fake = path.resolve(__dirname, '../fixtures/fake-claude-json.mjs');
let dir: string;
let scriptFile: string;
let logFile: string;

beforeAll(async () => { dir = await makeTempDir(); });
afterAll(async () => { delete process.env.FAKE_JSON_SCRIPT; delete process.env.FAKE_JSON_LOG; await cleanupTempDirs(); });
let seq = 0;
beforeEach(() => {
  seq++;
  scriptFile = path.join(dir, `script${seq}.json`);
  logFile = path.join(dir, `log${seq}.jsonl`);
  process.env.FAKE_JSON_SCRIPT = scriptFile;
  process.env.FAKE_JSON_LOG = logFile;
});

function script(entries: unknown[]): void {
  // Written synchronously enough for the next call: tests await call() after this.
  pending = writeFile(scriptFile, JSON.stringify(entries));
}
let pending: Promise<void> = Promise.resolve();

interface Items { items: { i: number; t: string }[] }
const isItems = (v: unknown): v is Items => !!v && typeof v === 'object' && Array.isArray((v as any).items)
  && (v as any).items.every((x: any) => typeof x?.i === 'number' && typeof x?.t === 'string');
const itemsSchema = { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { i: { type: 'integer' }, t: { type: 'string' } }, required: ['i', 't'] } } }, required: ['items'] };

async function call(o: Partial<Parameters<typeof runClaudeJson<Items>>[0]> = {}) {
  await pending;
  return runClaudeJson<Items>({ command: process.execPath, prefixArgs: [fake], cwd: dir, model: 'm', system: 'SYS', user: 'USER', schema: itemsSchema, validate: isItems, ...o });
}

async function lastCall(): Promise<{ args: string[]; stdin: string }> {
  const lines = (await readFile(logFile, 'utf8')).trim().split('\n');
  return JSON.parse(lines.at(-1)!);
}

test('성공', async () => {
  script([{ body: { is_error: false, subtype: 'success', structured_output: { items: [{ i: 0, t: '안녕' }] }, usage: { input_tokens: 5, output_tokens: 7, cache_read_input_tokens: 1, cache_creation_input_tokens: 2 } } }]);
  expect(await call()).toEqual({ ok: true, data: { items: [{ i: 0, t: '안녕' }] }, usage: { input: 5, output: 7, cacheRead: 1, cacheCreate: 2 } });
  const log = await lastCall(); expect(log.stdin).toBe('USER'); expect(log.args).toEqual(expect.arrayContaining(['--output-format', 'json', '--tools', '', '--setting-sources', 'project', '--system-prompt', 'SYS', '--json-schema']));
});
test.each([
  [{ exit: 1, stderr: 'Claude usage limit reached. Resets at 3pm', body: '' }, 'limit'],
  [{ exit: 1, stderr: 'Please run /login', body: '' }, 'auth'],
  [{ body: 'not json' }, 'invalid'],
  [{ body: { is_error: false, structured_output: { items: 'x' } } }, 'invalid'],
  [{ body: { is_error: false, result: '도와드릴 수 없습니다', stop_reason: 'refusal' } }, 'refused'],
  [{ exit: 2, stderr: 'boom', body: '' }, 'other'],
])('실패 판정 %#', async (entry, kind) => { script([entry]); expect(await call()).toMatchObject({ ok: false, kind }); });
test('없는 실행 파일과 중단', async () => {
  expect(await call({ command: 'C:/no/claude.exe', prefixArgs: [] })).toMatchObject({ ok: false, kind: 'spawn' });
  const ac = new AbortController(); script([{ delayMs: 2000, body: {} }]); const p = call({ signal: ac.signal }); ac.abort(); expect(await p).toMatchObject({ ok: false, kind: 'aborted' });
});

// Extra coverage beyond the plan's assertions.
test('is_error 결과와 시간 초과, 인자 전체', async () => {
  script([{ body: { is_error: true, subtype: 'error_during_execution', result: 'API Error: 429 rate limit', usage: { input_tokens: 3, output_tokens: 0 } } }]);
  expect(await call()).toMatchObject({ ok: false, kind: 'limit', message: 'API Error: 429 rate limit', usage: { input: 3, output: 0, cacheRead: 0, cacheCreate: 0 } });
  const log = await lastCall();
  const i = log.args.indexOf('--json-schema'); expect(JSON.parse(log.args[i + 1])).toEqual(itemsSchema);
  expect(log.args.slice(0, 3)).toEqual(['-p', '--model', 'm']);
  expect(log.args).toEqual(expect.arrayContaining(['--strict-mcp-config', '--disable-slash-commands']));
  await rm(`${scriptFile}.n`, { force: true });
  script([{ delayMs: 3000, body: {} }]);
  expect(await call({ timeoutMs: 300 })).toMatchObject({ ok: false, kind: 'other', message: '응답 시간이 초과됐습니다' });
  script([{ body: { is_error: true, result: 'Not logged in · Please run /login' } }]);
  await rm(`${scriptFile}.n`, { force: true });
  expect(await call()).toMatchObject({ ok: false, kind: 'auth' });
});
