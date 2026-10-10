// 016 (phát hiện khi nghiệm thu) · 009 FR-001 — hết hạn mức gói Claude là lỗi rate limit, không phải nội dung.
import { describe, expect, it } from 'vitest';
import { claudeTextProvider, openAICompatProvider } from '../../src/index.js';

const fakeQuery = (result: string, output_tokens: number) =>
  (() =>
    (async function* () {
      yield {
        type: 'result',
        subtype: 'success',
        result,
        usage: { input_tokens: 0, output_tokens },
        total_cost_usd: 0,
      };
    })()) as never;

describe('text.claude plan limit (009 FR-001)', () => {
  it('a session-limit notice becomes E_RUNTIME_RATE_LIMIT', async () => {
    const p = claudeTextProvider({
      query: fakeQuery("You've hit your session limit · resets 8:10am (Asia/Bangkok)", 0),
    });
    await expect(
      p.chat('claude-opus-5-5', {
        role: 'aux',
        messages: [{ role: 'user', content: 'x' }],
        max_tokens: 10,
      }),
    ).rejects.toMatchObject({
      code: 'E_RUNTIME_RATE_LIMIT',
    });
  });

  it('normal answers pass through', async () => {
    const p = claudeTextProvider({ query: fakeQuery('Xin chào', 3) });
    await expect(
      p.chat('m', { role: 'aux', messages: [{ role: 'user', content: 'x' }], max_tokens: 10 }),
    ).resolves.toMatchObject({ text: 'Xin chào' });
  });

  it('counts money only with an Anthropic API key; the subscription cost is notional (076)', async () => {
    const q = (() =>
      (async function* () {
        yield {
          type: 'result',
          subtype: 'success',
          result: 'ok',
          usage: { input_tokens: 10, output_tokens: 5 },
          total_cost_usd: 0.42,
        };
      })()) as never;
    const input = {
      role: 'aux' as const,
      messages: [{ role: 'user' as const, content: 'x' }],
      max_tokens: 10,
    };
    expect((await claudeTextProvider({ query: q }).chat('m', input)).cost_usd).toBe(0);
    expect(
      (await claudeTextProvider({ query: q, getApiKey: () => 'sk-ant-x' }).chat('m', input))
        .cost_usd,
    ).toBe(0.42);
  });

  it('turns off the built-in Claude Code tools: plain text, one turn (065 FR-TX-65-01)', async () => {
    let opts: Record<string, unknown> = {};
    const fake = fakeQuery('ok', 1) as unknown as () => AsyncGenerator;
    const q = ((a: { options: Record<string, unknown> }) => {
      opts = a.options;
      return fake();
    }) as never;
    await claudeTextProvider({ query: q }).chat('m', {
      role: 'aux',
      messages: [{ role: 'user', content: 'https://www.youtube.com/watch?v=x' }],
      max_tokens: 10,
    });
    expect(opts).toMatchObject({ tools: [], allowedTools: [], maxTurns: 1 });
  });

  it('no per-step output cap: Claude gets the model maximum, a cut-off answer is an error, not half a text', async () => {
    let env: Record<string, string> = {};
    const fake = fakeQuery('ok', 1) as unknown as () => AsyncGenerator;
    const q = ((a: { options: { env: Record<string, string> } }) => {
      env = a.options.env;
      return fake();
    }) as never;
    const input = {
      role: 'aux' as const,
      messages: [{ role: 'user' as const, content: 'x' }],
      max_tokens: 10,
    };
    await claudeTextProvider({ query: q }).chat('m', input);
    expect(env.CLAUDE_CODE_MAX_OUTPUT_TOKENS).toBe('64000');
    await expect(
      claudeTextProvider({
        query: fakeQuery(
          "API Error: Claude's response exceeded the 64000 output token maximum.",
          64000,
        ),
      }).chat('m', input),
    ).rejects.toMatchObject({ code: 'E_PROVIDER_FAILED' });
  });

  it('DeepSeek asks for its maximum and reports finish_reason=length as a cut-off', async () => {
    const bodies: Record<string, unknown>[] = [];
    let finish = 'stop';
    const real = globalThis.fetch;
    globalThis.fetch = (async (_u: string, init: { body: string }) => {
      bodies.push(JSON.parse(init.body) as Record<string, unknown>);
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'half a sto' }, finish_reason: finish }],
          usage: { prompt_tokens: 1, completion_tokens: 8192 },
        }),
      );
    }) as never;
    try {
      const p = openAICompatProvider({
        id: 'text.deepseek',
        baseUrl: 'http://x',
        secret: () => 'k',
        maxOutput: 8192,
      });
      const input = {
        role: 'aux' as const,
        messages: [{ role: 'user' as const, content: 'x' }],
        max_tokens: 2000,
      };
      await p.chat('deepseek-chat', input);
      expect(bodies[0]).toMatchObject({ max_tokens: 8192 });
      expect(bodies[0]).not.toHaveProperty('max_completion_tokens');
      finish = 'length';
      await expect(p.chat('deepseek-chat', input)).rejects.toMatchObject({
        code: 'E_PROVIDER_FAILED',
        message: expect.stringContaining('cut off'),
      });
    } finally {
      globalThis.fetch = real;
    }
  });
});
