// 077 — ComfyUI kẹt không trả ảnh: chờ có hạn, hủy lệnh trong ComfyUI rồi báo lỗi (không treo cả Autopilot).
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { ComfyClient } from '../../src/comfy/client.js';

let server: Server | undefined;
afterEach(() => new Promise<void>((r) => (server ? server.close(() => r()) : r())));

describe('ComfyClient.wait deadline (077)', () => {
  it('gives up after timeoutMs and cancels the prompt', async () => {
    const posted: string[] = [];
    server = createServer((req, res) => {
      if (req.method === 'POST') posted.push(req.url ?? '');
      res.setHeader('content-type', 'application/json');
      res.end('{}'); // /history/<id> mãi chưa có kết quả
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    const c = new ComfyClient(`http://127.0.0.1:${port}`);
    await expect(c.wait('p1', { pollMs: 20, timeoutMs: 300 })).rejects.toMatchObject({
      code: 'E_PROVIDER_FAILED',
      message: expect.stringMatching(/did not return an image within/),
    });
    expect(posted.sort()).toEqual(['/interrupt', '/queue']);
  });
});
