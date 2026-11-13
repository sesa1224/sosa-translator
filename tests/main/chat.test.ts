import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, expect, test } from 'vitest';
import { ClaudeChat, findClaude } from '../../src/main/claude/chat.js';
import type { ChatEvent } from '../../src/shared/api.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';

const fakePath = path.resolve(__dirname, '../fixtures/fake-claude.mjs');
let argsOut: string;
let opts: ConstructorParameters<typeof ClaudeChat>[0];
let chat: ClaudeChat;

function turn(c: ClaudeChat, text: string): Promise<ChatEvent[]> {
  return new Promise((resolve) => {
    const ev: ChatEvent[] = [];
    const on = (e: ChatEvent) => {
      ev.push(e);
      if (e.type === 'turn-end' || e.type === 'error') { c.off('event', on); resolve(ev); }
    };
    c.on('event', on);
    c.send(text);
  });
}
function firstEvent(c: ClaudeChat, act: () => void): Promise<ChatEvent> {
  return new Promise((resolve) => { c.once('event', resolve); act(); });
}
function spawns(): string[][] {
  return readFileSync(argsOut, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
}
const spawnCount = () => spawns().length;
const lastArgs = () => spawns().at(-1)!;

beforeEach(async () => {
  const dir = await makeTempDir();
  argsOut = path.join(dir, 'args.jsonl');
  process.env.FAKE_CLAUDE_ARGS_OUT = argsOut;
  opts = { command: process.execPath, prefixArgs: [fakePath], cwd: dir, mcpConfigPath: path.join(dir, 'mcp.json'), systemPrompt: 'S', model: 'claude-fable-5-2' };
  chat = new ClaudeChat(opts);
});
afterEach(() => { chat.dispose(); });
afterAll(async () => { delete process.env.FAKE_CLAUDE_ARGS_OUT; await cleanupTempDirs(); });

test('한 턴', async () => {
  const ev = await turn(chat, '안녕');
  expect(ev[0]).toMatchObject({ type: 'session' }); expect(ev.filter(e => e.type === 'text-delta').map((e: any) => e.text).join('')).toBe('받음: 안녕');
  expect(ev.at(-1)).toMatchObject({ type: 'turn-end', ok: true }); expect(chat.busy).toBe(false); expect(chat.sessionId).toBe('fake-session');
});
test('같은 프로세스로 두 번째 턴', async () => { await turn(chat, '하나'); await turn(chat, '둘'); expect(spawnCount()).toBe(1); });
test('턴 도중 다시 보내면 오류', () => { chat.send('하나'); expect(() => chat.send('둘')).toThrow('답을 기다리는 중입니다'); });
test('모델을 바꾸면 --resume 으로 다시 뜬다', async () => {
  await turn(chat, '하나'); chat.setModel('claude-haiku-5-5'); await turn(chat, '둘');
  const args = lastArgs(); expect(args).toContain('claude-haiku-5-5'); expect(args.slice(-2)).toEqual(['--resume', 'fake-session']);
});
test('프로세스가 죽어도 다음 턴은 된다', async () => {
  expect((await turn(chat, '죽어')).at(-1)).toMatchObject({ type: 'turn-end', ok: false });
  expect((await turn(chat, '다시')).at(-1)).toMatchObject({ type: 'turn-end', ok: true });
});
test('로그인 안 됨', async () => { expect((await turn(chat, '로그인')).at(-1)).toMatchObject({ ok: false, error: '로그인이 필요합니다. 터미널에서 claude 를 실행해 로그인하세요.' }); });
test('실행 파일이 없음', async () => {
  const c = new ClaudeChat({ ...opts, command: 'C:/no/such/claude.exe', prefixArgs: [] });
  expect(await firstEvent(c, () => c.send('x'))).toEqual({ type: 'error', message: 'Claude CLI를 실행할 수 없습니다. 설정에서 경로를 확인하세요.' }); expect(c.busy).toBe(false);
  c.dispose();
});
test('멈추기', async () => { chat.send('느리게'); chat.stop(); expect(chat.busy).toBe(false); expect((await turn(chat, '다시')).at(-1)).toMatchObject({ ok: true }); });

// Extra coverage beyond the plan's assertions.
test('새 대화는 session id 를 버리고 --resume 없이 뜬다', async () => {
  await turn(chat, '하나'); chat.reset(); expect(chat.sessionId).toBeNull();
  await turn(chat, '둘'); expect(lastArgs()).not.toContain('--resume'); expect(spawnCount()).toBe(2);
});
test('findClaude: 설정값이 있으면 그것, 없는 경로면 PATH 에서 찾는다', () => {
  expect(findClaude(fakePath)).toBe(fakePath);
  const savedPath = process.env.PATH;
  process.env.PATH = '';
  try { expect(findClaude('C:/no/such/claude.exe')).toBeNull(); } finally { process.env.PATH = savedPath; }
});
