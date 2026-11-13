import { spawn } from 'node:child_process';
import type { ChatUsage } from '../../shared/api.js';

export type JsonCallResult<T> =
  | { ok: true; data: T; usage: ChatUsage }
  | { ok: false; kind: 'limit' | 'auth' | 'refused' | 'invalid' | 'spawn' | 'aborted' | 'other'; message: string; usage: ChatUsage };

export interface JsonCallOptions<T> {
  command: string; prefixArgs?: string[]; cwd: string; model: string; system: string; user: string;
  schema: object; validate: (v: unknown) => v is T; signal?: AbortSignal; timeoutMs?: number;
}

const DEFAULT_TIMEOUT = 10 * 60 * 1000;
const STDERR_KEEP = 8192;
const LIMIT_PATTERN = /usage limit|rate limit|limit reached|429/i;
const AUTH_PATTERN = /\/login|not logged in|authentication/i;
export const CANNOT_RUN_JSON = 'Claude CLI를 실행할 수 없습니다. 설정에서 경로를 확인하세요.';
export const TIMED_OUT = '응답 시간이 초과됐습니다';
const ABORTED = '멈췄습니다';

const zero = (): ChatUsage => ({ input: 0, output: 0, cacheRead: 0, cacheCreate: 0 });

function usageOf(u: any): ChatUsage {
  const n = (v: unknown) => (typeof v === 'number' ? v : 0);
  return { input: n(u?.input_tokens), output: n(u?.output_tokens), cacheRead: n(u?.cache_read_input_tokens), cacheCreate: n(u?.cache_creation_input_tokens) };
}

/** Arguments for one headless call that must answer with JSON matching the schema. No tools, no MCP. */
export function buildJsonArgs(o: { model: string; system: string; schema: object }): string[] {
  return [
    '-p', '--model', o.model, '--output-format', 'json',
    '--tools', '', '--strict-mcp-config',
    '--setting-sources', 'project', '--disable-slash-commands',
    '--system-prompt', o.system,
    '--json-schema', JSON.stringify(o.schema),
  ];
}

function lastLine(s: string): string {
  return s.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).at(-1) ?? '';
}

/**
 * Runs the Claude CLI once with --json-schema; the user text goes on stdin.
 * Never throws: every failure comes back as { ok: false, kind }.
 */
export function runClaudeJson<T>(o: JsonCallOptions<T>): Promise<JsonCallResult<T>> {
  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort = (): void => undefined;
    const finish = (r: JsonCallResult<T>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      o.signal?.removeEventListener('abort', onAbort);
      resolve(r);
    };
    const fail = (kind: Extract<JsonCallResult<T>, { ok: false }>['kind'], message: string, usage = zero()) =>
      finish({ ok: false, kind, message, usage });

    if (o.signal?.aborted) {
      fail('aborted', ABORTED);
      return;
    }

    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(o.command, [...(o.prefixArgs ?? []), ...buildJsonArgs(o)], {
        cwd: o.cwd, windowsHide: true, stdio: 'pipe', shell: /\.(cmd|bat)$/i.test(o.command),
      });
    } catch (e) {
      fail('spawn', `${CANNOT_RUN_JSON} (${e instanceof Error ? e.message : String(e)})`);
      return;
    }
    const kill = () => {
      try {
        child.kill();
      } catch {
        // already gone
      }
    };
    onAbort = () => {
      kill();
      fail('aborted', ABORTED);
    };
    o.signal?.addEventListener('abort', onAbort);
    timer = setTimeout(() => {
      kill();
      fail('other', TIMED_OUT);
    }, o.timeoutMs ?? DEFAULT_TIMEOUT);

    let stdout = '';
    let stderr = '';
    child.stdout!.setEncoding('utf8');
    child.stderr!.setEncoding('utf8');
    child.stdout!.on('data', (c: string) => { stdout += c; });
    child.stderr!.on('data', (c: string) => { stderr = (stderr + c).slice(-STDERR_KEEP); });
    child.stdin!.on('error', () => undefined);
    child.on('error', (e) => fail('spawn', `${CANNOT_RUN_JSON} (${e.message})`));
    child.on('close', (code) => {
      if (settled) return;
      let msg: any;
      try {
        msg = JSON.parse(stdout.trim());
      } catch {
        msg = undefined;
      }
      const usage = msg && typeof msg === 'object' ? usageOf(msg.usage) : zero();
      const resultText = msg && typeof msg.result === 'string' ? msg.result : '';
      if ((msg && msg.is_error === true) || code !== 0) {
        const text = `${resultText}\n${stderr}`;
        const message = resultText || lastLine(stderr) || `Claude CLI가 끝났습니다 (종료 코드 ${code})`;
        if (LIMIT_PATTERN.test(text)) return fail('limit', message, usage);
        if (AUTH_PATTERN.test(text)) return fail('auth', message, usage);
        return fail('other', message, usage);
      }
      if (!msg || typeof msg !== 'object') return fail('invalid', '응답을 JSON 으로 읽을 수 없습니다', usage);
      if (msg.structured_output === undefined || msg.structured_output === null) {
        if (resultText && msg.stop_reason === 'refusal') return fail('refused', resultText, usage);
        return fail('invalid', resultText ? `정해진 형식의 답이 없습니다: ${resultText.slice(0, 200)}` : '정해진 형식의 답이 없습니다', usage);
      }
      if (!o.validate(msg.structured_output)) return fail('invalid', '답이 정해진 형식과 다릅니다', usage);
      finish({ ok: true, data: msg.structured_output, usage });
    });
    child.stdin!.end(o.user, 'utf8');
  });
}
