import type { ChatEvent, ChatImage, ChatUsage } from '../../shared/api.js';
import { MCP_TOOL_PREFIX } from './args.js';

const SUMMARY_LENGTH = 200;

function usageOf(u: any): ChatUsage {
  const n = (v: unknown) => (typeof v === 'number' ? v : 0);
  return {
    input: n(u?.input_tokens),
    output: n(u?.output_tokens),
    cacheRead: n(u?.cache_read_input_tokens),
    cacheCreate: n(u?.cache_creation_input_tokens),
  };
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map((c) => (c && typeof c === 'object' && typeof (c as any).text === 'string' ? (c as any).text : '')).join('');
  }
  return '';
}

/** Turns one parsed stream-json line into chat events. Unknown shapes give nothing. */
function eventsOf(msg: any): ChatEvent[] {
  if (!msg || typeof msg !== 'object') return [];
  switch (msg.type) {
    case 'system':
      return msg.subtype === 'init' && typeof msg.session_id === 'string'
        ? [{ type: 'session', sessionId: msg.session_id, model: String(msg.model ?? '') }]
        : [];
    case 'stream_event': {
      const ev = msg.event;
      return ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && typeof ev.delta.text === 'string'
        ? [{ type: 'text-delta', text: ev.delta.text }]
        : [];
    }
    case 'assistant': {
      const out: ChatEvent[] = [];
      for (const b of Array.isArray(msg.message?.content) ? msg.message.content : []) {
        if (b?.type === 'text' && typeof b.text === 'string') out.push({ type: 'text', text: b.text });
        else if (b?.type === 'tool_use') {
          const name = String(b.name ?? '');
          out.push({ type: 'tool-start', id: String(b.id ?? ''), name: name.startsWith(MCP_TOOL_PREFIX) ? name.slice(MCP_TOOL_PREFIX.length) : name, input: b.input });
        }
      }
      return out;
    }
    case 'user': {
      const out: ChatEvent[] = [];
      for (const b of Array.isArray(msg.message?.content) ? msg.message.content : []) {
        if (b?.type === 'tool_result') {
          out.push({ type: 'tool-end', id: String(b.tool_use_id ?? ''), isError: b.is_error === true, summary: resultText(b.content).slice(0, SUMMARY_LENGTH) });
        }
      }
      return out;
    }
    case 'result': {
      const ok = msg.subtype === 'success' && msg.is_error !== true;
      const ev: ChatEvent = { type: 'turn-end', ok, usage: usageOf(msg.usage) };
      if (!ok) ev.error = typeof msg.result === 'string' && msg.result ? msg.result : String(msg.subtype ?? '오류');
      return [ev];
    }
    default:
      return [];
  }
}

/** Line-oriented stream-json parser. Chunks may end in the middle of a line. */
export class StreamParser {
  private buf = '';

  push(chunk: string): ChatEvent[] {
    this.buf += chunk;
    const out: ChatEvent[] = [];
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      let msg: unknown;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      out.push(...eventsOf(msg));
    }
    return out;
  }
}

/** One stdin line for --input-format stream-json (ends with '\n'). */
export function userMessageLine(text: string, images: ChatImage[]): string {
  const content: unknown[] = [{ type: 'text', text }];
  for (const img of images) content.push({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } });
  return JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n';
}
