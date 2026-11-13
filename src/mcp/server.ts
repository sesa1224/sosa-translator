// Small stdio MCP server started by the Claude CLI. It owns no data: every tools/list and
// tools/call is forwarded to the app's local bridge (127.0.0.1 + bearer token).
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const url = process.env.MVMZ_BRIDGE_URL;
const token = process.env.MVMZ_BRIDGE_TOKEN;

async function bridge(pathName: string, body?: unknown): Promise<any> {
  if (!url || !token) throw new Error('MVMZ_BRIDGE_URL / MVMZ_BRIDGE_TOKEN 이 없습니다');
  const res = await fetch(url + pathName, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`앱 연결 오류 (${res.status})`);
  return res.json();
}

const server = new Server({ name: 'mvmz', version: '0.1.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: await bridge('/tools') }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  try {
    const r = await bridge('/call', { name: req.params.name, input: req.params.arguments ?? {} });
    // Pictures (plan 7) go after the text block so the text still comes first.
    if (r.ok && Array.isArray(r.images) && r.images.length > 0) return { content: [{ type: 'text', text: JSON.stringify(r.data) }, ...r.images.map((i: { mediaType: string; base64: string }) => ({ type: 'image' as const, data: i.base64, mimeType: i.mediaType }))] };
    if (r.ok) return { content: [{ type: 'text', text: JSON.stringify(r.data) }] };
    return { content: [{ type: 'text', text: JSON.stringify({ error: r.error }) }], isError: true };
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: e instanceof Error ? e.message : String(e) }) }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
