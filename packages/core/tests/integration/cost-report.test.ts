// 028 · AC-M3-04 (FR-OB-03/04) — bảng usage ghi từ span; báo cáo chi phí theo video → bước → loại khớp
// trace; CSV; xuất OTLP sang Phoenix; `sf eval compare`.
import { createHash } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  costCsv,
  costReport,
  createCore,
  createTextService,
  evalCompare,
  flushPhoenix,
  setPhoenixExport,
  tracer,
  withSpan,
  type Core,
} from '../../src/index.js';
import { copyChannel, fixtureAppData, fixtureVideoId, tempDir } from '../domain-helpers.js';

let server: http.Server;
let base = '';
const otlp: { path: string; bytes: number }[] = [];
beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = Buffer.alloc(0);
    req.on('data', (c: Buffer) => (body = Buffer.concat([body, c])));
    req.on('end', () => {
      if (req.url?.startsWith('/v1/traces')) {
        otlp.push({ path: req.url, bytes: body.length });
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{}');
        return;
      }
      const b = JSON.parse(body.toString('utf8')) as { model?: string };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          model: b.model,
          choices: [{ message: { content: 'Xin chào' } }],
          usage: { prompt_tokens: 1000, completion_tokens: 200 },
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

function setup(): { core: Core; dir: string; app: string } {
  const c = copyChannel();
  const t = tempDir('app-');
  const s = JSON.parse(readFileSync(path.join(fixtureAppData, 'settings.json'), 'utf8'));
  s.pricing = [
    ...(s.pricing ?? []),
    { provider: 'text.openai', model: 'gpt-x', unit: 'mtok_out', usd: 10 },
    { provider: 'image.qwen20-api', model: 'qwen-image', unit: 'image', usd: 0.03 },
  ];
  writeFileSync(path.join(t.dir, 'settings.json'), JSON.stringify(s));
  const core = createCore({ appDataDir: t.dir });
  cleanups.push(() => core.close(), c.cleanup, t.cleanup);
  return { core, dir: c.dir, app: t.dir };
}

describe('cost report (028 FR-OB-03, AC-M3-04)', () => {
  it('usage recorded from spans matches the trace per video → step → kind', async () => {
    const { core, dir, app } = setup();
    const store = core.gateway.storeFor(dir);
    const text = createTextService({
      appDataDir: app,
      getSecret: (n) => (n === 'openai' ? 'sk-test' : undefined),
      endpoints: { openai: `${base}/v1` },
    });
    const call = () =>
      text.generate(
        'primary',
        { role: 'primary', messages: [{ role: 'user', content: 'Chào' }], max_tokens: 50 },
        { store, videoId: fixtureVideoId, model: { provider: 'openai', model: 'gpt-x' } },
      );
    const step = (id: string, fn: () => Promise<unknown>) =>
      withSpan('sf.workflow.step', { 'sf.video_id': fixtureVideoId, 'sf.step_id': id }, fn);
    await step('script', async () => {
      await call();
      await call();
    });
    await step('storyboard', async () => {
      // phiên agent (gói Claude: token, chi phí 0) + ảnh API (giá ước tính) + GPU cục bộ
      const s = tracer().startSpan('sf.agent.session', {
        attributes: { 'sf.session_kind': 'producer' },
      });
      s.setAttributes({ 'gen_ai.usage.input_tokens': 5000, 'gen_ai.usage.output_tokens': 700 });
      s.end();
      await withSpan(
        'sf.provider.run',
        {
          'sf.provider': 'image.qwen20-api',
          'sf.model': 'qwen-image',
          'sf.video_id': fixtureVideoId,
        },
        async (sp) => {
          sp.setAttributes({ 'sf.from_cache': false, 'sf.cost_kind': 'per_image', 'sf.units': 1 });
        },
      );
      await withSpan(
        'sf.provider.run',
        { 'sf.provider': 'image.qwen21-comfy', 'sf.video_id': fixtureVideoId },
        async (sp) => {
          sp.setAttributes({ 'sf.from_cache': false, 'sf.cost_kind': 'free', 'sf.gpu_ms': 41_500 });
        },
      );
      // cache hit → không tính
      await withSpan(
        'sf.provider.run',
        { 'sf.provider': 'x', 'sf.video_id': fixtureVideoId },
        async (sp) => {
          sp.setAttributes({ 'sf.from_cache': true, 'sf.gpu_ms': 999 });
        },
      );
    });
    await call(); // ngoài bước (chat)

    const r = costReport(core.db, store, fixtureVideoId, app);
    const by = Object.fromEntries(r.steps.map((s) => [s.step_id ?? '-', s]));
    expect(by.script!.kinds.llm).toMatchObject({
      calls: 2,
      input_tokens: 2000,
      output_tokens: 400,
    });
    expect(by.storyboard!.kinds).toMatchObject({
      llm: { calls: 1, input_tokens: 5000, output_tokens: 700, cost_usd: 0 },
      image_api: { images: 1, cost_usd: 0.03 },
      gpu: { gpu_s: 41.5 },
    });
    expect(by['-']!.total.calls).toBe(1);
    expect(r.estimated).toBe(true);

    // khớp trace: tổng token/chi phí của span cùng video (AC-M3-04)
    const spans = core.db
      .prepare("SELECT name, attrs FROM spans WHERE name IN ('sf.text.call', 'sf.agent.session')")
      .all() as { name: string; attrs: string }[];
    const sum = (k: string) =>
      spans.reduce(
        (s, x) => s + Number((JSON.parse(x.attrs) as Record<string, number>)[k] ?? 0),
        0,
      );
    expect(r.total.input_tokens).toBe(sum('gen_ai.usage.input_tokens'));
    expect(r.total.output_tokens).toBe(sum('gen_ai.usage.output_tokens'));
    expect(r.total.cost_usd).toBeCloseTo(sum('sf.cost_usd') + 0.03, 6);
    // ngân sách video lấy từ state.json (text service cộng sau mỗi lời gọi)
    expect(r.budget.tokens_used).toBeGreaterThanOrEqual(3 * 1200);
    expect(r.budget.limit_api_cost_usd).toBe(5);

    const csv = costCsv(r).split('\n');
    expect(csv[0]).toBe(
      'video_id,step_id,kind,calls,input_tokens,output_tokens,cost_usd,gpu_s,images',
    );
    expect(csv).toContain(`${fixtureVideoId},storyboard,gpu,1,0,0,0,41.5,0`);
    expect(csv.at(-1)).toMatch(new RegExp(`^${fixtureVideoId},,total,`));
  });

  it('exports spans to Phoenix over OTLP HTTP when enabled (FR-OB-04)', async () => {
    setup();
    setPhoenixExport(true, base);
    try {
      await withSpan('sf.workflow.step', { 'sf.step_id': 'phoenix-test' }, async () => {});
      await flushPhoenix();
      expect(otlp.some((o) => o.path === '/v1/traces' && o.bytes > 0)).toBe(true);
    } finally {
      setPhoenixExport(false);
    }
    const n = otlp.length;
    await withSpan('sf.workflow.step', { 'sf.step_id': 'after-off' }, async () => {});
    await flushPhoenix();
    expect(otlp.length).toBe(n);
  });
});

describe('sf eval compare (028, D11 mục 4)', () => {
  it('groups by producer model: approval without major edit, critic score, rounds, tokens/video', () => {
    const c = copyChannel();
    cleanups.push(c.cleanup);
    const v = path.join(c.dir, 'videos', fixtureVideoId);
    const st = JSON.parse(readFileSync(path.join(v, 'state.json'), 'utf8'));
    const script = readFileSync(path.join(v, 'SCRIPT.md'), 'utf8');
    // bản duyệt nằm trong sao lưu; bản hiện tại sửa nhẹ (< 10% số từ)
    mkdirSync(path.join(v, '.sf', 'backups', '2026-10-04T00-00-00Z'), { recursive: true });
    copyFileSync(
      path.join(v, 'SCRIPT.md'),
      path.join(v, '.sf', 'backups', '2026-10-04T00-00-00Z', 'SCRIPT.md'),
    );

    st.workflow = { id: 'narrated-explainer', version: '1.0.0' };
    st.approvals = [
      {
        id: 'ap_aaaaaaaa',
        step_id: 'script',
        status: 'approved',
        requested_at: '2026-10-04T00:00:00Z',
        artifact_hashes: { 'SCRIPT.md': createHash('sha256').update(script).digest('hex') },
      },
    ];
    st.budget = { tokens_used: 4000, api_cost_usd: 0 };
    writeFileSync(path.join(v, 'state.json'), JSON.stringify(st));
    writeFileSync(path.join(v, 'SCRIPT.md'), script.replace('Lê Lợi', 'Lê Lợi đã'));
    mkdirSync(path.join(v, 'reviews', 'script'), { recursive: true });
    for (const [n, score] of [
      [1, 6],
      [2, 8],
    ])
      writeFileSync(
        path.join(v, 'reviews', 'script', `round-${n}.json`),
        JSON.stringify({
          schema_version: 1,
          step_id: 'script',
          round: n,
          artifact: 'SCRIPT.md',
          draft_hash: '0'.repeat(64),
          producer: { provider: 'claude', model: 'opus' },
          critic: { provider: 'openai', model: 'gpt-x' },
          objective_checks: [],
          score,
          criteria: [],
          issues: [],
          tokens: { input: 0, output: 0 },
          cost_usd: 0,
          created_at: '2026-10-04T00:00:00Z',
        }),
      );
    expect(evalCompare(c.dir, 'producer_model')).toEqual([
      {
        group: 'claude/opus',
        videos: 1,
        approved_without_major_edit: 1,
        avg_critic_score: 8,
        avg_rounds: 2,
        tokens_per_video: 4000,
      },
    ]);
    expect(evalCompare(c.dir, 'rubric_version')[0]!.group).toBe('script-default@1');
  });
});
