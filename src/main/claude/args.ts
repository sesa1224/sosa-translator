export const MCP_SERVER_NAME = 'mvmz';
export const CHAT_TOOLS = ['project_status', 'search_units', 'get_unit', 'set_translation', 'set_status', 'undo_last', 'glossary_search', 'glossary_set_term', 'list_decisions', 'set_decision'];
export const MCP_TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`;

/** Arguments for a headless, stream-json Claude CLI session limited to the app's MCP tools. */
export function buildClaudeArgs(o: { model: string; mcpConfigPath: string; systemPrompt: string; resumeSessionId?: string }): string[] {
  const args = [
    '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--model', o.model,
    '--mcp-config', o.mcpConfigPath, '--strict-mcp-config',
    '--tools', '',
    '--allowedTools', CHAT_TOOLS.map((t) => MCP_TOOL_PREFIX + t).join(','),
    '--permission-mode', 'dontAsk',
    // Keep the user's global plugins, hooks and skills out of this session, and replace the
    // default coding-agent system prompt: together they cost ~5-7k tokens on every call.
    '--setting-sources', 'project', '--disable-slash-commands',
    '--system-prompt', o.systemPrompt,
  ];
  if (o.resumeSessionId) args.push('--resume', o.resumeSessionId);
  return args;
}

// Plan 5: event and patch tools (appended so the list above stays as it was).
CHAT_TOOLS.push('event_files', 'event_list', 'event_read', 'usage_search', 'event_patch');
