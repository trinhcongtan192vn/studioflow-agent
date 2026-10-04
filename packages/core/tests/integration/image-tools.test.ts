// 018 · US1/US2/US4, FR-004/005, SC-003 — tool ảnh → asset kênh + public video + provenance + cache.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  createCore,
  imageInfo,
  type PermissionRequest,
  type SessionContext,
} from '../../src/index.js';
import { copyChannel, fixtureAppData, fixtureVideoId, tempDir } from '../domain-helpers.js';

beforeAll(() => {
  process.env.SF_GPU = '0';
});
const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c();
  delete process.env.DASHSCOPE_API_KEY;
});

type Done = {
  data: {
    status: string;
    result: {
      asset_id: string;
      file: string;
      public?: string;
      alpha: boolean;
      width: number;
      height: number;
      seed: number;
      from_cache: boolean;
    };
    error?: { code: string; message: string };
  };
};

function setup(settings: Record<string, unknown> = {}) {
  const c = copyChannel();
  const t = tempDir('app-');
  const base = JSON.parse(readFileSync(path.join(fixtureAppData, 'settings.json'), 'utf8'));
  writeFileSync(path.join(t.dir, 'settings.json'), JSON.stringify({ ...base, ...settings }));
  const core = createCore({ appDataDir: t.dir, backoffMs: [10, 20], permissionTimeoutMs: 2000 });
  cleanups.push(c.cleanup, t.cleanup, () => core.close());
  const session: SessionContext = {
    session_id: 'ss_test0001',
    kind: 'main',
    channel_dir: c.dir,
    video_id: fixtureVideoId,
  };
  const store = core.gateway.storeFor(c.dir);
  const run = async (tool: string, input: unknown) => {
    const r = (await core.gateway.call(session, tool, input)) as {
      ok: boolean;
      job_id?: string;
      error?: { code: string };
    };
    if (!r.ok) return r as unknown as Done & { ok: false; error: { code: string } };
    return (await core.gateway.call(session, 'job.wait', {
      job_id: r.job_id,
      timeout_ms: 60_000,
    })) as Done;
  };
  const manifest = () =>
    JSON.parse(readFileSync(store.abs('assets/manifest.json'), 'utf8')) as {
      assets: {
        id: string;
        file: string;
        alpha?: boolean;
        width?: number;
        source: { kind: string };
      }[];
    };
  return { core, dir: c.dir, store, run, manifest };
}

describe('image tools (018)', () => {
  it('image.generate → channel asset (generated) + video public copy + provenance; seed → cache', async () => {
    const { store, run, manifest } = setup();
    const a = await run('image.generate', {
      prompt: 'bản đồ cổ',
      width: 1000,
      height: 560,
      seed: 11,
    });
    expect(a.data.status).toBe('succeeded');
    const r = a.data.result;
    expect(r).toMatchObject({ width: 992, height: 576, alpha: false, seed: 11, from_cache: false });
    expect(r.file).toBe(`assets/files/${r.asset_id}.png`);
    expect(existsSync(store.abs(`videos/${fixtureVideoId}/public/${r.asset_id}.png`))).toBe(true);
    const entry = manifest().assets.find((x) => x.id === r.asset_id)!;
    expect(entry).toMatchObject({ source: { kind: 'generated' }, width: 992, alpha: false });
    expect(imageInfo(readFileSync(store.abs(r.file)))).toMatchObject({ width: 992, height: 576 });
    const again = await run('image.generate', {
      prompt: 'bản đồ cổ',
      width: 1000,
      height: 560,
      seed: 11,
    });
    expect(again.data.result).toMatchObject({ from_cache: true, asset_id: r.asset_id });
    // không có seed → app chọn và ghi lại
    const free = await run('image.generate', { prompt: 'bản đồ cổ', width: 512, height: 512 });
    expect(Number.isInteger(free.data.result.seed)).toBe(true);
  });

  it('transparent → RGBA asset; image.edit → new asset, source unchanged; unknown source → E_ID_UNKNOWN', async () => {
    const { store, run, manifest } = setup();
    const t = await run('image.generate', {
      prompt: 'đèn lồng',
      width: 512,
      height: 512,
      transparent: true,
      seed: 1,
    });
    expect(t.data.result.alpha).toBe(true);
    expect(manifest().assets.find((x) => x.id === t.data.result.asset_id)!.alpha).toBe(true);
    const srcBefore = readFileSync(store.abs(t.data.result.file));
    const e = await run('image.edit', {
      source_asset_id: t.data.result.asset_id,
      instruction: 'đổi màu xanh',
      seed: 2,
    });
    expect(e.data.status).toBe('succeeded');
    expect(e.data.result.asset_id).not.toBe(t.data.result.asset_id);
    expect(readFileSync(store.abs(t.data.result.file)).equals(srcBefore)).toBe(true);
    const bad = await run('image.edit', { source_asset_id: 'as_zzzzzzzz', instruction: 'x' });
    expect(bad).toMatchObject({ ok: false, error: { code: 'E_ID_UNKNOWN' } });
  });

  it('image.remove_bg → transparent PNG asset (hyperframes remove-background, CPU)', async () => {
    const { run } = setup();
    const g = await run('image.generate', {
      prompt: 'trống đồng',
      width: 256,
      height: 256,
      seed: 5,
    });
    const r = await run('image.remove_bg', {
      source_asset_id: g.data.result.asset_id,
      subject: 'object',
    });
    expect(r.data.status, JSON.stringify(r.data.error)).toBe('succeeded');
    expect(r.data.result.alpha).toBe(true);
  }, 180_000);

  it('paid API provider asks first; sends the DashScope request; transparent unsupported', async () => {
    const t = tempDir('img-');
    cleanups.push(t.cleanup);
    const seen: {
      auth?: string;
      body: { model: string; parameters: { size: string; seed: number } };
    }[] = [];
    let srv: Server;
    const png = path.join(t.dir, 'out.png');
    await new Promise<void>((res) => {
      srv = createServer((req, resp) => {
        const chunks: Buffer[] = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          if (req.url === '/img.png') {
            resp.writeHead(200, { 'content-type': 'image/png' });
            return resp.end(readFileSync(png));
          }
          seen.push({
            auth: req.headers.authorization,
            body: JSON.parse(Buffer.concat(chunks).toString()),
          });
          const port = (srv.address() as AddressInfo).port;
          resp.writeHead(200, { 'content-type': 'application/json' });
          resp.end(
            JSON.stringify({
              output: {
                choices: [
                  { message: { content: [{ image: `http://127.0.0.1:${port}/img.png` }] } },
                ],
              },
              usage: { width: 512, height: 512, image_count: 1 },
            }),
          );
        });
      }).listen(0, '127.0.0.1', () => res());
    });
    cleanups.push(() => new Promise<void>((r) => srv.close(() => r())));
    const port = (srv!.address() as AddressInfo).port;
    process.env.DASHSCOPE_API_KEY = 'sk-test-1234';
    const { core, store, run } = setup({
      provider_settings: {
        'image.qwen20-api': {
          endpoint: `http://127.0.0.1:${port}/api/v1/services/aigc/multimodal-generation/generation`,
        },
      },
    });
    // ảnh nguồn PNG cho mock: lấy từ image.fake
    const g = await run('image.generate', { prompt: 'x', width: 512, height: 512, seed: 9 });
    copyFileSync(store.abs(g.data.result.file), png);
    const ch = JSON.parse(readFileSync(store.abs('channel.json'), 'utf8'));
    ch.config['provider.image.generate'] = 'image.qwen20-api';
    writeFileSync(store.abs('channel.json'), JSON.stringify(ch));
    let answer = false;
    const asked: PermissionRequest[] = [];
    core.gateway.permissions.on('permission.requested', (req: PermissionRequest) => {
      asked.push(req);
      core.gateway.permissions.decide({ request_id: req.request_id, allow: answer });
    });
    const declined = await run('image.generate', { prompt: 'x', width: 512, height: 512, seed: 9 });
    expect(declined).toMatchObject({ ok: false, error: { code: 'E_PERMISSION_DECLINED' } });
    expect(asked[0]).toMatchObject({ kind: 'paid_api' });
    answer = true;
    const ok = await run('image.generate', { prompt: 'x', width: 512, height: 512, seed: 9 });
    expect(ok.data.status, JSON.stringify(ok.data.error)).toBe('succeeded');
    // khóa cache khác provider fake → không trúng cache
    expect(ok.data.result.from_cache).toBe(false);
    expect(seen[0]).toMatchObject({
      auth: 'Bearer sk-test-1234',
      body: { model: 'qwen-image-2.0', parameters: { size: '512*512', seed: 9 } },
    });
    const tr = await run('image.generate', {
      prompt: 'x',
      width: 512,
      height: 512,
      transparent: true,
    });
    expect(tr.data.status).toBe('failed');
    expect(tr.data.error?.code).toBe('E_PROVIDER_UNSUPPORTED');
  });
});
