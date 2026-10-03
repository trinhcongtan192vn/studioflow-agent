// 003 · US5 · FR-018, FR-019 · SC-003 — MCP client thật qua Streamable HTTP.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, describe, expect, it } from 'vitest';
import { startHttpGateway } from '../../src/index.js';
import { gatewayFixture } from '../gateway-helpers.js';

const fx = gatewayFixture();
afterAll(() => fx.cleanup());

async function connect(url: string, token: string) {
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(url), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
}

describe('MCP over HTTP (003 US5)', () => {
  it('lists only tools allowed for the session kind, MCP names use _', async () => {
    const srv = await startHttpGateway(fx.gw, fx.session({ kind: 'critic' }));
    try {
      expect(srv.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
      const client = await connect(srv.url, srv.token);
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name)).toEqual(['artifact_read']);
      await client.close();
    } finally {
      await srv.close();
    }
  });

  it('calls a tool and returns ToolResult JSON', async () => {
    const srv = await startHttpGateway(fx.gw, fx.session());
    try {
      const client = await connect(srv.url, srv.token);
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'artifact_read',
          'artifact_write',
          'artifact_list',
          'artifact_validate',
          'config_resolve',
          'config_set',
          'script_run',
        ]),
      );
      const r = await client.callTool({ name: 'artifact_read', arguments: { path: 'SCRIPT.md' } });
      const result = JSON.parse((r.content as { text: string }[])[0]!.text);
      expect(result).toMatchObject({
        ok: true,
        data: { hash: expect.stringMatching(/^[0-9a-f]{64}$/), schema_version: 1 },
      });
      expect(r.isError).toBeFalsy();
      const bad = await client.callTool({
        name: 'artifact_read',
        arguments: { path: '../channel.json' },
      });
      expect(bad.isError).toBe(true);
      expect(JSON.parse((bad.content as { text: string }[])[0]!.text)).toMatchObject({
        ok: false,
        error: { code: 'E_PATH_OUTSIDE', retryable: false },
      });
      await client.close();
    } finally {
      await srv.close();
    }
  });

  it('rejects requests without or with a wrong token (401)', async () => {
    const srv = await startHttpGateway(fx.gw, fx.session());
    try {
      const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
      const headers = {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      };
      expect((await fetch(srv.url, { method: 'POST', headers, body })).status).toBe(401);
      expect(
        (
          await fetch(srv.url, {
            method: 'POST',
            headers: { ...headers, authorization: 'Bearer nope' },
            body,
          })
        ).status,
      ).toBe(401);
    } finally {
      await srv.close();
    }
  });
});
