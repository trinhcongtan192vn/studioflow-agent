// 009 · US2 · FR-001..003 — provider text: OpenAI-compatible qua máy chủ HTTP cục bộ; thiếu khóa; ngân sách.
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createTextService, WriteStore, type TextService } from '../../src/index.js';
import { copyChannel, fixtureAppData, fixtureVideoId, tempDir } from '../domain-helpers.js';

let server: http.Server;
let base = '';
const seen: { auth?: string; body: Record<string, unknown> }[] = [];
beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const b = JSON.parse(body) as { messages: { role: string; content: string }[] };
      seen.push({ auth: req.headers.authorization, body: b });
      const reviewing = b.messages.some((m) => m.content.includes('"criteria"'));
      const content = reviewing
        ? JSON.stringify({
            criteria: [
              { id: 'hook', score: 8, note: 'ổn' },
              { id: 'clarity', score: 6 },
            ],
            // model hay thêm trường ngoài schema (vd_mdxzk4ui) → app bỏ
            issues: [{ id: 'i1', severity: 'minor', text: 'câu 2 dài', fix: 'cắt đôi' }],
          })
        : 'Xin chào';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          model: (b as { model?: string }).model,
          choices: [{ message: { content } }],
          usage: { prompt_tokens: 12, completion_tokens: 3 },
        }),
      );
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
});
afterAll(() => server.close());
const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((c) => c()));

function svc(getSecret: (n: string) => string | undefined): { s: TextService; dir: string } {
  const c = copyChannel();
  const t = tempDir('llm-');
  cleanups.push(c.cleanup, t.cleanup);
  const s = createTextService({
    appDataDir: fixtureAppData,
    getSecret,
    fixtureDir: t.dir,
    mode: 'record',
    endpoints: { openai: base },
  });
  return { s, dir: c.dir };
}

describe('text providers (009 FR-001)', () => {
  it('OpenAI-compatible generate with the key, tokens/cost added to the video budget', async () => {
    const { s, dir } = svc((n) => (n === 'openai' ? 'sk-test-123' : undefined));
    const store = new WriteStore(dir);
    // 085: OpenAI không còn là producer mặc định — chọn tường minh (không gọi Claude thật)
    const out = await s.generate(
      'primary',
      { role: 'primary', messages: [{ role: 'user', content: 'Chào' }], max_tokens: 50 },
      { store, videoId: fixtureVideoId, model: { provider: 'openai', model: 'gpt-5' } },
    );
    expect(out).toMatchObject({
      text: 'Xin chào',
      usage: { input: 12, output: 3 },
      model: 'gpt-5',
    });
    expect(seen.at(-1)!.auth).toBe('Bearer sk-test-123');
    const st = JSON.parse(
      readFileSync(path.join(dir, 'videos', fixtureVideoId, 'state.json'), 'utf8'),
    );
    expect(st.budget.tokens_used).toBe(12000 + 15);
  });

  it('review parses JSON, computes the weighted score from the rubric', async () => {
    const { s, dir } = svc((n) => (n === 'openai' ? 'sk-test-123' : undefined));
    const rubric = {
      id: 'r',
      version: 1,
      scale: 10 as const,
      criteria: [
        { id: 'hook', weight: 0.5, prompt: 'H' },
        { id: 'clarity', weight: 0.5, prompt: 'C' },
      ],
      severity_rules: 's',
    };
    const r = await s.review(
      { artifact_text: 'nháp', rubric, brief: 'b' },
      { store: new WriteStore(dir), critic: { provider: 'openai', model: 'gpt-5' } },
    );
    expect(r).toMatchObject({
      score: 7,
      criteria: [
        { id: 'hook', score: 8, weight: 0.5 },
        { id: 'clarity', score: 6, weight: 0.5 },
      ],
      issues: [{ severity: 'minor' }],
    });
    expect(r.issues).toEqual([{ severity: 'minor', text: 'câu 2 dài' }]);
  });

  it('a missing key makes the provider unavailable', async () => {
    const { s, dir } = svc(() => undefined);
    await expect(
      s.generate(
        'primary',
        { role: 'primary', messages: [{ role: 'user', content: 'x' }], max_tokens: 5 },
        { store: new WriteStore(dir), model: { provider: 'deepseek', model: 'deepseek-chat' } },
      ),
    ).rejects.toMatchObject({ code: 'E_PROVIDER_UNAVAILABLE' });
  });
});
