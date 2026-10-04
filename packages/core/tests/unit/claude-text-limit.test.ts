// 016 (phát hiện khi nghiệm thu) · 009 FR-001 — hết hạn mức gói Claude là lỗi rate limit, không phải nội dung.
import { describe, expect, it } from 'vitest';
import { claudeTextProvider } from '../../src/index.js';

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
});
