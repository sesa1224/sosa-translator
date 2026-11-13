// Stand-in for a one-shot `claude -p --output-format json` call in tests.
//  - FAKE_JSON_SCRIPT: path of a JSON array of answers, used one per call in order
//    ({ exit?: number, stderr?: string, delayMs?: number, body: object | string }).
//    The call counter is kept in <FAKE_JSON_SCRIPT>.n; when the script runs out the last answer repeats.
//  - FAKE_JSON_LOG: each call appends one JSON line { args, stdin }.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const chunks = [];
process.stdin.on('data', (c) => chunks.push(c));
process.stdin.on('end', async () => {
  const stdin = Buffer.concat(chunks).toString('utf8');
  if (process.env.FAKE_JSON_LOG) appendFileSync(process.env.FAKE_JSON_LOG, JSON.stringify({ args, stdin }) + '\n');
  const scriptFile = process.env.FAKE_JSON_SCRIPT;
  const script = scriptFile ? JSON.parse(readFileSync(scriptFile, 'utf8')) : [];
  const counter = `${scriptFile}.n`;
  const n = scriptFile && existsSync(counter) ? Number(readFileSync(counter, 'utf8')) : 0;
  if (scriptFile) writeFileSync(counter, String(n + 1));
  const entry = script[Math.min(n, script.length - 1)] ?? { body: {} };
  if (entry.delayMs) await new Promise((r) => setTimeout(r, entry.delayMs));
  if (entry.stderr) process.stderr.write(entry.stderr + '\n');
  process.stdout.write(typeof entry.body === 'string' ? entry.body : JSON.stringify(entry.body));
  process.exitCode = entry.exit ?? 0;
});
