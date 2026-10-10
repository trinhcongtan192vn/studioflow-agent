// 095 FR-AG-95-02..03: stdio integration against a local protocol fixture.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CodexPlanRuntime, codexRead } from '../../src/agent/codex.js';
import type { SessionOptions } from '../../src/contracts/types.js';
import { Gateway } from '../../src/gateway/gateway.js';
const fixture = fileURLToPath(new URL('../fixtures/codex-server.mjs', import.meta.url));

describe('095 Codex plan adapter', () => {
  it.each(['exit', 'limit', 'wait'])(
    'settles on process %s without hanging or retrying inference',
    async (behavior) => {
      const home = mkdtempSync(path.join(os.tmpdir(), 'sf-codex-'));
      const rt = new CodexPlanRuntime({
        gateway: new Gateway(),
        home,
        command: () => process.execPath,
        args: [fixture],
        env: { SF_TEST_CODEX_BEHAVIOR: behavior },
      });
      const session = await rt.openSession({
        kind: 'main',
        context: { kind: 'main', session_id: 'ss_test', channel_dir: home },
        model: '',
        systemAppend: '',
        plugins: [],
        tools: { allowed: [], readRoots: [] },
        telemetry: { traceparent: '' },
      } as SessionOptions);
      try {
        const events = [];
        for await (const e of session.send({ text: 'x' })) {
          events.push(e);
          if (behavior === 'wait' && e.type === 'text_delta') await session.interrupt();
        }
        if (behavior === 'limit')
          expect(events).toContainEqual(expect.objectContaining({ code: 'E_RUNTIME_RATE_LIMIT' }));
        if (behavior === 'exit')
          expect(events).toContainEqual(expect.objectContaining({ code: 'E_PROVIDER_FAILED' }));
        if (behavior === 'wait') expect(events.filter((e) => e.type === 'error')).toEqual([]);
      } finally {
        await session.close();
        await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
      }
    },
  );
  it('confines plugin Read to declared roots and denies it for critic/ops', async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'sf-codex-'));
    const other = mkdtempSync(path.join(os.tmpdir(), 'sf-codex-out-'));
    writeFileSync(path.join(home, 'skill.md'), 'app instructions');
    writeFileSync(path.join(other, 'private.txt'), 'private');
    const o = {
      context: { channel_dir: home },
      tools: { allowed: ['Read'], readRoots: [home] },
    } as unknown as SessionOptions;
    try {
      expect(codexRead(o, { file_path: 'skill.md' })).toBe('app instructions');
      expect(() => codexRead(o, { file_path: path.join(other, 'private.txt') })).toThrow('outside');
      expect(() =>
        codexRead({ ...o, tools: { ...o.tools, allowed: [] } }, { file_path: 'skill.md' }),
      ).toThrow('unavailable');
    } finally {
      await rm(home, { recursive: true });
      await rm(other, { recursive: true });
    }
  });
  it('streams text, delegates allowed tools to Gateway, reports usage and closes', async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'sf-codex-'));
    const gw = new Gateway();
    let called = false;
    gw.register({
      name: 'artifact.read',
      description: 'read',
      input: { type: 'object' },
      handler: async () => {
        called = true;
        return { text: 'script' };
      },
    } as never);
    const rt = new CodexPlanRuntime({
      gateway: gw,
      home,
      command: () => process.execPath,
      args: [fixture],
    });
    const o = {
      kind: 'main',
      context: { kind: 'main', session_id: 'ss_test', channel_dir: home },
      model: '',
      telemetry: { traceparent: '' },
      systemAppend: 'test',
      plugins: [],
      tools: { allowed: ['mcp__sf__artifact_read'], readRoots: [home] },
      maxTurns: 3,
    } as SessionOptions;
    const session = await rt.openSession(o);
    try {
      const events = [];
      for await (const e of session.send({ text: 'hello' })) events.push(e);
      expect(called).toBe(true);
      expect(events).toContainEqual({ type: 'text_delta', text: 'hello' });
      expect(events).toContainEqual({
        type: 'usage',
        input_tokens: 12,
        output_tokens: 3,
        cost_usd: 0,
      });
      expect(events.at(-1)).toEqual({ type: 'done', stop_reason: 'end_turn' });
    } finally {
      await session.close();
      await rt.close();
      await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });
  it('rejects API-key auth rather than incurring API charges', async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'sf-codex-'));
    const rt = new CodexPlanRuntime({
      gateway: new Gateway(),
      home,
      command: () => process.execPath,
      args: [fixture],
      env: { SF_TEST_CODEX_AUTH: 'apiKey' },
    });
    try {
      expect(await rt.authStatus()).toMatchObject({ ok: false, method: 'none' });
    } finally {
      await rt.close();
      await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });
  it('reports actual model and chooses a distinct critic model for text calls', async () => {
    const home = mkdtempSync(path.join(os.tmpdir(), 'sf-codex-'));
    const rt = new CodexPlanRuntime({
      gateway: new Gateway(),
      home,
      command: () => process.execPath,
      args: [fixture],
    });
    const input = {
      role: 'aux' as const,
      messages: [{ role: 'user' as const, content: 'write' }],
      max_tokens: 100,
    };
    try {
      expect(await rt.text(input)).toMatchObject({
        text: 'hello',
        model: 'codex/test-model',
        cost_usd: 0,
      });
      expect(await rt.text(input, true)).toMatchObject({
        text: 'hello',
        model: 'codex/critic-model',
        cost_usd: 0,
      });
    } finally {
      await rt.close();
      await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  });
});
