// Stand-in for a one-shot `claude -p --output-format json` call in tests.
//  - FAKE_JSON_SCRIPT: path of a JSON array of answers, used one per call in order
//    ({ exit?: number, stderr?: string, delayMs?: number, body: object | string }).
//    The call counter is kept in <FAKE_JSON_SCRIPT>.n; when the script runs out the last answer repeats.
//    Without FAKE_JSON_SCRIPT it answers by the --json-schema it was given (used by the app smoke test):
//    script reading notes, glossary draft, translation ('번역' + the item's control codes) or review (a remark on 月光草).
//  - FAKE_JSON_LOG: each call appends one JSON line { args, stdin }.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const CODE = /\\[A-Za-z]+(?:\[[^\]\r\n]*\])?|\\[{}.|!><^$\\]|%\d+/g;
const usage = { input_tokens: 120, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

function auto(args, stdin) {
  const i = args.indexOf('--json-schema');
  const keys = Object.keys(JSON.parse(args[i + 1]).properties ?? {});
  const user = JSON.parse(stdin);
  let out;
  if (keys.includes('styleNotes')) {
    out = {
      terms: [
        { source: 'アーテル', category: 'name', candidates: [{ target: '아텔', reason: '이름' }] },
        { source: 'リナ', category: 'name', candidates: [{ target: '리나', reason: '흔한 표기' }, { target: '린', reason: '짧은 애칭' }] },
        { source: '月光草', category: 'term', candidates: [{ target: '월광초', reason: '한자 그대로' }] },
      ],
      characters: [{ source: 'リナ', target: '리나', speech: '밝은 반말' }],
      styleNotes: '밝은 분위기의 약초원 이야기.',
    };
  } else if (keys.includes('style')) {
    out = { characters: [{ name: 'アーテル', traits: '차분함', speech: '반말', moans: '짧게 참는 소리' }], terms: [], sfx: [], style: '' };
  } else if (keys.includes('problems')) {
    const hit = user.items.find((x) => x.source === '月光草');
    out = { problems: hit ? [{ i: hit.i, problem: '용어가 어색함', suggestion: '월광초(검수)' }] : [] };
  } else {
    out = { items: user.items.map((x) => ({ i: x.i, t: '번역' + (x.text.match(CODE) ?? []).join('') })) };
  }
  return { body: { type: 'result', subtype: 'success', is_error: false, result: '', structured_output: out, usage } };
}

const args = process.argv.slice(2);
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', async () => {
  const stdin = Buffer.concat(chunks).toString('utf8');
  if (process.env.FAKE_JSON_LOG) appendFileSync(process.env.FAKE_JSON_LOG, JSON.stringify({ args, stdin }) + '\n');
  const scriptFile = process.env.FAKE_JSON_SCRIPT;
  let entry;
  if (scriptFile) {
    const script = JSON.parse(readFileSync(scriptFile, 'utf8'));
    const counter = `${scriptFile}.n`;
    const n = existsSync(counter) ? Number(readFileSync(counter, 'utf8')) : 0;
    writeFileSync(counter, String(n + 1));
    entry = script[Math.min(n, script.length - 1)] ?? { body: {} };
  } else entry = auto(args, stdin);
  if (entry.delayMs) await new Promise((r) => setTimeout(r, entry.delayMs));
  if (entry.stderr) process.stderr.write(entry.stderr + '\n');
  process.stdout.write(typeof entry.body === 'string' ? entry.body : JSON.stringify(entry.body));
  process.exitCode = entry.exit ?? 0;
});
