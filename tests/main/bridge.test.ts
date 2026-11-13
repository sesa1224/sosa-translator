import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { startBridge, writeMcpConfig } from '../../src/main/bridge.js';
import { ProjectService } from '../../src/main/projectService.js';
import { cleanupTempDirs, makeTempDir } from '../helpers/fs.js';
import { freshGame, idFinder } from './helpers.js';

const root = path.resolve(__dirname, '../..');
const builtServerPath = path.join(root, 'out/main/mcp-server.js');

let svc: ProjectService;
let bridge: Awaited<ReturnType<typeof startBridge>>;
const clients: Client[] = [];
const idOf = idFinder(() => svc.units());

async function connectStdioClient(command: string, args: string[], env: Record<string, string>): Promise<Client> {
  const client = new Client({ name: 'bridge-test', version: '0.0.0' });
  await client.connect(new StdioClientTransport({ command, args, env, stderr: 'pipe' }));
  clients.push(client);
  return client;
}

beforeAll(async () => {
  // The MCP server runs as a separate process, so test the real build output.
  execFileSync(process.execPath, [path.join(root, 'node_modules/electron-vite/bin/electron-vite.js'), 'build'], { cwd: root, stdio: 'ignore' });
  const { game, proj } = await freshGame();
  svc = await ProjectService.create(game, proj, '약초원');
  bridge = await startBridge(() => svc);
}, 120000);
afterAll(async () => {
  for (const c of clients) await c.close();
  await bridge.close(); await svc.close(); await cleanupTempDirs();
});

test('토큰이 없으면 401', async () => { expect((await fetch(bridge.url + '/tools')).status).toBe(401); });
test('MCP 클라이언트로 도구를 부르면 프로젝트가 바뀐다', async () => {
  const client = await connectStdioClient(process.execPath, [builtServerPath], { MVMZ_BRIDGE_URL: bridge.url, MVMZ_BRIDGE_TOKEN: bridge.token });
  expect((await client.listTools()).tools.map(t => t.name).sort()).toEqual(['get_unit', 'project_status', 'search_units', 'set_status', 'set_translation', 'undo_last']);
  const res = await client.callTool({ name: 'set_translation', arguments: { id: idOf('月光草'), target: '월광초' } });
  expect(res.isError).toBeFalsy(); expect(svc.entry(idOf('月光草')).target).toBe('월광초');
  expect((await client.callTool({ name: 'get_unit', arguments: { id: 'nope' } })).isError).toBe(true);
});
test('127.0.0.1 에서만 듣는다', () => { expect(new URL(bridge.url).hostname).toBe('127.0.0.1'); });

// Extra coverage beyond the plan's assertions.
test('토큰이 맞으면 도구 목록, 프로젝트가 없으면 오류', async () => {
  const auth = { Authorization: `Bearer ${bridge.token}` };
  const tools = await (await fetch(bridge.url + '/tools', { headers: auth })).json();
  expect(tools.find((t: any) => t.name === 'search_units').inputSchema).toMatchObject({ type: 'object', required: ['query'] });
  expect((await fetch(bridge.url + '/call', { method: 'POST', headers: { Authorization: 'Bearer wrong' }, body: '{}' })).status).toBe(401);
  const empty = await startBridge(() => null);
  const r = await fetch(empty.url + '/call', { method: 'POST', headers: { Authorization: `Bearer ${empty.token}` }, body: JSON.stringify({ name: 'project_status', input: {} }) });
  expect(await r.json()).toEqual({ ok: false, error: '열린 프로젝트가 없습니다' });
  await empty.close();
});
test('MCP 설정 파일', async () => {
  const dir = await makeTempDir();
  const file = await writeMcpConfig(dir, { url: 'http://127.0.0.1:1', token: 't' }, 'C:/app/mcp-server.js', 'C:/app/app.exe');
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ mcpServers: { mvmz: {
    command: 'C:/app/app.exe', args: ['C:/app/mcp-server.js'],
    env: { MVMZ_BRIDGE_URL: 'http://127.0.0.1:1', MVMZ_BRIDGE_TOKEN: 't', ELECTRON_RUN_AS_NODE: '1' } } } });
});
