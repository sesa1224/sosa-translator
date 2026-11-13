// Stand-in for the Claude CLI in tests. Speaks the stream-json protocol on stdin/stdout.
//  - appends its argv (JSON, one line per start) to FAKE_CLAUDE_ARGS_OUT
//  - prints an init line, then for each stdin line: two text deltas ('받음: ', text), an assistant line, a result line
//  - '죽어' exits with code 3, '로그인' prints a login error and exits 1, '느리게' answers after 2 s
import { appendFileSync } from 'node:fs';
import readline from 'node:readline';

const args = process.argv.slice(2);
if (process.env.FAKE_CLAUDE_ARGS_OUT) appendFileSync(process.env.FAKE_CLAUDE_ARGS_OUT, JSON.stringify(args) + '\n');

const model = args[args.indexOf('--model') + 1] ?? 'fake-model';
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

out({ type: 'system', subtype: 'init', session_id: 'fake-session', model, tools: [] });

const rl = readline.createInterface({ input: process.stdin });
let chain = Promise.resolve();
rl.on('line', (line) => {
  chain = chain.then(() => answer(line));
});

async function answer(line) {
  let text = '';
  try {
    const msg = JSON.parse(line);
    text = msg.message.content.find((c) => c.type === 'text')?.text ?? '';
  } catch {
    return;
  }
  if (text === '죽어') process.exit(3);
  if (text === '로그인') {
    process.stderr.write('Invalid API key · Please run /login\n');
    process.exit(1);
  }
  if (text === '느리게') await sleep(2000);
  const delta = (t) => out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } } });
  delta('받음: ');
  delta(text);
  out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: '받음: ' + text }] } });
  out({ type: 'result', subtype: 'success', is_error: false, result: '받음: ' + text, session_id: 'fake-session',
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 50, cache_creation_input_tokens: 10 } });
}
