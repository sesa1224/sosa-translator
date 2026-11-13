import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { z } from 'zod';
import type { ProjectService } from './projectService.js';
import { callTool, TOOL_DEFS } from './toolHandlers.js';

const MAX_BODY = 5 * 1024 * 1024;

export interface Bridge { url: string; token: string; close(): Promise<void> }

export interface BridgeTool { name: string; description: string; inputSchema: Record<string, unknown> }

function toolList(): BridgeTool[] {
  return TOOL_DEFS.map((d) => {
    const { $schema: _ignored, ...schema } = z.toJSONSchema(d.inputSchema) as Record<string, unknown>;
    return { name: d.name, description: d.description, inputSchema: schema };
  });
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(text);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('요청이 너무 큽니다'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Local HTTP bridge between the MCP server process and the main process.
 * Listens on 127.0.0.1 only; every request needs `Authorization: Bearer <token>`.
 */
export async function startBridge(getService: () => ProjectService | null): Promise<Bridge> {
  const token = randomBytes(24).toString('hex');
  const server = http.createServer((req, res) => {
    void (async () => {
      if (req.headers.authorization !== `Bearer ${token}`) return send(res, 401, { ok: false, error: 'unauthorized' });
      if (req.method === 'GET' && req.url === '/tools') return send(res, 200, toolList());
      if (req.method === 'POST' && req.url === '/call') {
        let msg: { name?: unknown; input?: unknown };
        try {
          msg = JSON.parse(await readBody(req));
        } catch {
          return send(res, 400, { ok: false, error: '요청을 읽을 수 없습니다' });
        }
        const svc = getService();
        if (!svc) return send(res, 200, { ok: false, error: '열린 프로젝트가 없습니다' });
        return send(res, 200, await callTool(svc, String(msg.name ?? ''), msg.input));
      }
      return send(res, 404, { ok: false, error: 'not found' });
    })().catch((e) => send(res, 500, { ok: false, error: e instanceof Error ? e.message : String(e) }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    token,
    close: () => new Promise<void>((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    }),
  };
}

/**
 * Writes <dir>/mcp.json for `claude --mcp-config`. ELECTRON_RUN_AS_NODE makes the Electron
 * binary behave as plain Node (and is ignored by a real Node binary).
 */
export async function writeMcpConfig(
  dir: string,
  bridge: { url: string; token: string },
  serverScript: string,
  nodePath: string,
): Promise<string> {
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'mcp.json');
  const config = {
    mcpServers: {
      mvmz: {
        command: nodePath,
        args: [serverScript],
        env: { MVMZ_BRIDGE_URL: bridge.url, MVMZ_BRIDGE_TOKEN: bridge.token, ELECTRON_RUN_AS_NODE: '1' },
      },
    },
  };
  await writeFile(file, JSON.stringify(config, null, 2), 'utf8');
  return file;
}
