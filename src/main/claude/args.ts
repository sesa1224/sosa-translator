// Command-line arguments for the chat's Claude CLI session.
//
// The session may use only the app's MCP tools (src/main/toolHandlers.ts, served by src/mcp/server.ts).
// Every tool the chat can call must be listed in CHAT_TOOLS too, or the CLI refuses it.

export const MCP_SERVER_NAME = 'mvmz';
/** Tools the chat may call, in the order they are allowed (a test checks the exact argument). */
export const CHAT_TOOLS = [
  'project_status', 'search_units', 'get_unit', 'set_translation', 'set_status', 'undo_last', 'glossary_search', 'glossary_set_term', 'list_decisions', 'set_decision',
  'image_sheet', 'image_view', 'image_set_recipe', 'image_set_status', 'image_list',
  'event_files', 'event_list', 'event_read', 'usage_search', 'event_patch', 'set_josa_plugin',
  'update_summary',
  'find_game_text', 'add_extract_text',
];
export const MCP_TOOL_PREFIX = `mcp__${MCP_SERVER_NAME}__`;

/** Arguments for a headless, stream-json Claude CLI session limited to the app's MCP tools. */
export function buildClaudeArgs(o: { model: string; mcpConfigPath: string; systemPrompt: string; resumeSessionId?: string }): string[] {
  const args = [
    '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages',
    '--model', o.model,
    '--mcp-config', o.mcpConfigPath, '--strict-mcp-config',
    // No built-in tools (files, shell, web): the chat reaches the game only through the app's tools,
    // and every built-in tool's description would be sent with each turn.
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
