import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { ChatEvent, ChatImage } from '../../shared/api.js';
import { buildClaudeArgs } from './args.js';
import { StreamParser, userMessageLine } from './stream.js';

export const CANNOT_RUN = 'Claude CLI를 실행할 수 없습니다. 설정에서 경로를 확인하세요.';
export const NEED_LOGIN = '로그인이 필요합니다. 터미널에서 claude 를 실행해 로그인하세요.';
const STOPPED = '멈췄습니다';
const STDERR_KEEP = 4096;
const LOGIN_PATTERN = /\/login|not logged in/i;

const ZERO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 };

export interface ClaudeChatOptions {
  command: string; prefixArgs?: string[]; cwd: string; mcpConfigPath: string; systemPrompt: string; model: string;
}

export interface ClaudeChat {
  on(event: 'event', listener: (e: ChatEvent) => void): this;
  once(event: 'event', listener: (e: ChatEvent) => void): this;
  off(event: 'event', listener: (e: ChatEvent) => void): this;
  emit(event: 'event', e: ChatEvent): boolean;
}

/**
 * One Claude CLI process in stream-json mode, reused across turns.
 * Never throws out of callbacks; after any failure the next send() starts a fresh process
 * that resumes the same session.
 */
export class ClaudeChat extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private model: string;
  private restartAfterTurn = false;
  private _busy = false;
  private _sessionId: string | null = null;

  constructor(private readonly o: ClaudeChatOptions) {
    super();
    this.model = o.model;
  }

  get busy(): boolean {
    return this._busy;
  }

  get sessionId(): string | null {
    return this._sessionId;
  }

  send(text: string, images: ChatImage[] = []): void {
    if (this._busy) throw new Error('답을 기다리는 중입니다');
    const child = this.proc ?? this.start();
    if (!child) return;
    this._busy = true;
    child.stdin.write(userMessageLine(text, images));
  }

  /** Applies from the next send: the process is restarted with --resume. */
  setModel(model: string): void {
    if (model === this.model) return;
    this.model = model;
    if (this._busy) this.restartAfterTurn = true;
    else this.kill();
  }

  /** Stops the running turn by ending the process. The conversation continues with --resume. */
  stop(): void {
    const wasBusy = this._busy;
    this.kill();
    if (wasBusy) this.emit('event', { type: 'turn-end', ok: false, usage: { ...ZERO_USAGE }, error: STOPPED });
  }

  /** Starts a new conversation. */
  reset(): void {
    this.stop();
    this._sessionId = null;
  }

  dispose(): void {
    this.kill();
    this.removeAllListeners();
  }

  private kill(): void {
    const p = this.proc;
    this.proc = null;
    this._busy = false;
    this.restartAfterTurn = false;
    if (p && p.exitCode === null) {
      try {
        p.kill();
      } catch {
        // already gone
      }
    }
  }

  private start(): ChildProcessWithoutNullStreams | null {
    const args = [...(this.o.prefixArgs ?? []), ...buildClaudeArgs({
      model: this.model, mcpConfigPath: this.o.mcpConfigPath, systemPrompt: this.o.systemPrompt,
      resumeSessionId: this._sessionId ?? undefined,
    })];
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(this.o.command, args, {
        cwd: this.o.cwd, windowsHide: true, stdio: 'pipe',
        shell: /\.(cmd|bat)$/i.test(this.o.command),
      });
    } catch {
      this.emit('event', { type: 'error', message: CANNOT_RUN });
      return null;
    }
    this.proc = child;
    const parser = new StreamParser();
    let stderr = '';
    let failed = false;

    child.stdin.on('error', () => undefined);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (this.proc !== child) return;
      for (const ev of parser.push(chunk)) this.handle(ev);
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-STDERR_KEEP);
    });
    child.on('error', () => {
      failed = true;
      if (this.proc !== child) return;
      this.proc = null;
      this._busy = false;
      this.emit('event', { type: 'error', message: CANNOT_RUN });
    });
    child.on('close', (code) => {
      if (failed || this.proc !== child) return;
      this.proc = null;
      if (!this._busy) return;
      this._busy = false;
      const lines = stderr.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const error = LOGIN_PATTERN.test(stderr) ? NEED_LOGIN : (lines.at(-1) ?? `Claude CLI가 끝났습니다 (종료 코드 ${code})`);
      this.emit('event', { type: 'turn-end', ok: false, usage: { ...ZERO_USAGE }, error });
    });
    return child;
  }

  private handle(ev: ChatEvent): void {
    if (ev.type === 'session') this._sessionId = ev.sessionId;
    if (ev.type === 'turn-end') {
      this._busy = false;
      if (!ev.ok && ev.error && LOGIN_PATTERN.test(ev.error)) ev = { ...ev, error: NEED_LOGIN };
      if (this.restartAfterTurn) this.kill();
    }
    this.emit('event', ev);
  }
}

/** Configured path if it exists, else claude(.exe/.cmd) on PATH (.exe first), else null. */
export function findClaude(configured: string | null): string | null {
  if (configured && existsSync(configured)) return configured;
  const dirs = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const names = process.platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude'];
  for (const name of names) {
    for (const d of dirs) {
      const p = path.join(d, name);
      if (existsSync(p)) return p;
    }
  }
  return null;
}
