import { expect, test } from 'vitest';
import type { ProjectMeta } from '../../src/core/index.js';
import { buildClaudeArgs } from '../../src/main/claude/args.js';
import { buildSystemPrompt } from '../../src/main/claude/prompt.js';
import { StreamParser, userMessageLine } from '../../src/main/claude/stream.js';
import type { Stats } from '../../src/shared/api.js';

const meta: ProjectMeta = {
  name: '약초원', engine: 'MZ', gameDir: 'C:/game', contentPrefix: '', sourceLang: 'ja', targetLang: 'ko',
  versions: [{ id: 'v1', importedAt: '2026-11-13T00:00:00.000Z' }], current: 'v1',
};
const stats: Stats = { total: 12, untranslated: 10, needsReview: 1, approved: 1, error: 0, needsDecision: 2, declined: 0, provisional: 0, external: 0, undecided: 2, changed: 0, carried: 0, translated: 0 };

test('인자', () => {
  const a = buildClaudeArgs({ model: 'claude-opus-5-5', mcpConfigPath: 'C:/x/mcp.json', systemPrompt: 'S' });
  expect(a).toEqual(['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--model', 'claude-opus-5-5', '--mcp-config', 'C:/x/mcp.json', '--strict-mcp-config', '--tools', '',
    '--allowedTools', 'mcp__mvmz__project_status,mcp__mvmz__search_units,mcp__mvmz__get_unit,mcp__mvmz__set_translation,mcp__mvmz__set_status,mcp__mvmz__undo_last,mcp__mvmz__glossary_search,mcp__mvmz__glossary_set_term,mcp__mvmz__list_decisions,mcp__mvmz__set_decision,mcp__mvmz__image_sheet,mcp__mvmz__image_view,mcp__mvmz__image_set_recipe,mcp__mvmz__image_set_status,mcp__mvmz__image_list,mcp__mvmz__event_files,mcp__mvmz__event_list,mcp__mvmz__event_read,mcp__mvmz__usage_search,mcp__mvmz__event_patch,mcp__mvmz__update_summary',
    '--permission-mode', 'dontAsk', '--setting-sources', 'project', '--disable-slash-commands', '--system-prompt', 'S']);
  expect(buildClaudeArgs({ model: 'm', mcpConfigPath: 'p', systemPrompt: 'S', resumeSessionId: 'abc' }).slice(-2)).toEqual(['--resume', 'abc']);
});
test('잘린 줄을 이어 붙인다', () => {
  const p = new StreamParser(); const line = JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1', model: 'm' }) + '\n';
  expect(p.push(line.slice(0, 10))).toEqual([]); expect(p.push(line.slice(10))).toEqual([{ type: 'session', sessionId: 's1', model: 'm' }]);
});
test('도구 호출과 결과, 끝', () => {
  const p = new StreamParser();
  expect(p.push(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: '찾아볼게' }, { type: 'tool_use', id: 't1', name: 'mcp__mvmz__search_units', input: { query: '記録' } }] } }) + '\n'))
    .toEqual([{ type: 'text', text: '찾아볼게' }, { type: 'tool-start', id: 't1', name: 'search_units', input: { query: '記録' } }]);
  expect(p.push(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false, content: [{ type: 'text', text: '{"total":1}' }] }] } }) + '\n'))
    .toEqual([{ type: 'tool-end', id: 't1', isError: false, summary: '{"total":1}' }]);
  expect(p.push(JSON.stringify({ type: 'result', subtype: 'success', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 3, cache_creation_input_tokens: 1 } }) + '\n'))
    .toEqual([{ type: 'turn-end', ok: true, usage: { input: 10, output: 5, cacheRead: 3, cacheCreate: 1 } }]);
});
test('쓰레기 줄과 모르는 type 은 무시', () => { expect(new StreamParser().push('hello\n{"type":"zzz"}\n')).toEqual([]); });
test('입력 줄에 이미지가 들어간다', () => {
  const m = JSON.parse(userMessageLine('이거 봐', [{ mediaType: 'image/png', base64: 'AAAA' }]));
  expect(m.message.content).toEqual([{ type: 'text', text: '이거 봐' }, { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }]);
});
test('시스템 프롬프트', () => { const s = buildSystemPrompt(meta, stats); expect(s).toContain('약초원'); expect(s).toContain('search_units'); expect(s).toContain('MZ'); });

// Extra coverage beyond the plan's assertions.
test('text-delta, 실패한 결과, 문자열 tool_result, CRLF', () => {
  const p = new StreamParser();
  expect(p.push(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '안' } } }) + '\r\n'))
    .toEqual([{ type: 'text-delta', text: '안' }]);
  expect(p.push(JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: '{' } } }) + '\n')).toEqual([]);
  expect(p.push(JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'x'.repeat(300) }] } }) + '\n'))
    .toEqual([{ type: 'tool-end', id: 't2', isError: true, summary: 'x'.repeat(200) }]);
  expect(p.push(JSON.stringify({ type: 'result', subtype: 'error_during_execution', is_error: true, result: '망함', usage: {} }) + '\n'))
    .toEqual([{ type: 'turn-end', ok: false, usage: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 }, error: '망함' }]);
  expect(userMessageLine('a', []).endsWith('\n')).toBe(true);
  const s = buildSystemPrompt(meta, stats);
  for (const must of ['get_unit', '%1', 'needsDecision', '한국어']) expect(s).toContain(must);
});
