// 095 FR-AG-95-03
import { describe, expect, it, vi } from 'vitest';
import { createTextService } from '../../src/text/service.js';
import { WriteStore } from '../../src/store/writer.js';
import { copyChannel, tempDir } from '../domain-helpers.js';

describe('095 text subscription fallback', () => {
  it('uses Codex after Claude plan limit and reports its model and zero API cost', async () => {
    const dir = copyChannel();
    const app = tempDir();
    try {
      const query = vi.fn(() =>
        (async function* () {
          yield {
            type: 'result',
            subtype: 'success',
            result: "You've hit your weekly limit",
            usage: { input_tokens: 0, output_tokens: 0 },
          };
        })(),
      );
      const codexText = vi.fn(async () => ({
        text: 'fallback text',
        usage: { input: 10, output: 3 },
        cost_usd: 0,
        model: 'codex/test-model',
      }));
      const service = createTextService({
        appDataDir: app.dir,
        getSecret: () => undefined,
        query: query as never,
        codexText,
      });
      const scope = {
        store: new WriteStore(dir.dir),
        model: { provider: 'claude', model: 'claude-sonnet-5-5' },
      };
      const input = {
        role: 'aux' as const,
        messages: [{ role: 'user' as const, content: 'write' }],
        max_tokens: 100,
      };
      expect(await service.generate('aux', input, scope)).toMatchObject({
        text: 'fallback text',
        model: 'codex/test-model',
        cost_usd: 0,
      });
      await service.generate('aux', input, scope);
      expect(query).toHaveBeenCalledTimes(1);
      expect(codexText).toHaveBeenCalledTimes(2);
    } finally {
      dir.cleanup();
      app.cleanup();
    }
  });
});
