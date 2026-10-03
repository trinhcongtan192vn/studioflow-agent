// 005 · FR-006 — thông điệp SDK → AgentEvent.
import { describe, expect, it } from 'vitest';
import { agentErrorFrom, mapSdkMessage } from '../../src/index.js';

describe('mapSdkMessage (005 FR-006)', () => {
  it('maps streaming text deltas', () => {
    expect(
      mapSdkMessage({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Xin ' },
        },
      }),
    ).toEqual([{ type: 'text_delta', text: 'Xin ' }]);
    expect(mapSdkMessage({ type: 'stream_event', event: { type: 'message_start' } })).toEqual([]);
  });

  it('maps tool_use blocks in assistant messages to tool_call', () => {
    const ev = mapSdkMessage({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: 'ok' },
          {
            type: 'tool_use',
            id: 'tu_1',
            name: 'mcp__sf__artifact_read',
            input: { path: 'SCRIPT.md' },
          },
        ],
      },
    });
    expect(ev).toEqual([
      {
        type: 'tool_call',
        id: 'tu_1',
        name: 'mcp__sf__artifact_read',
        input: { path: 'SCRIPT.md' },
      },
    ]);
  });

  it('maps tool results with a short summary', () => {
    const long = 'x'.repeat(500);
    expect(
      mapSdkMessage({
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tu_1', content: [{ type: 'text', text: long }] },
          ],
        },
      }),
    ).toEqual([{ type: 'tool_result', id: 'tu_1', ok: true, summary: 'x'.repeat(200) }]);
    expect(
      mapSdkMessage({
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tu_2', is_error: true, content: 'denied' },
          ],
        },
      }),
    ).toEqual([{ type: 'tool_result', id: 'tu_2', ok: false, summary: 'denied' }]);
  });

  it('maps result to usage + done', () => {
    expect(
      mapSdkMessage({
        type: 'result',
        subtype: 'success',
        usage: { input_tokens: 10, output_tokens: 5 },
        total_cost_usd: 0.01,
        stop_reason: 'end_turn',
      }),
    ).toEqual([
      { type: 'usage', input_tokens: 10, output_tokens: 5, cost_usd: 0.01 },
      { type: 'done', stop_reason: 'end_turn' },
    ]);
    expect(
      mapSdkMessage({
        type: 'result',
        subtype: 'error_max_turns',
        usage: { input_tokens: 1, output_tokens: 1 },
        total_cost_usd: 0,
      }),
    ).toEqual([
      { type: 'usage', input_tokens: 1, output_tokens: 1, cost_usd: 0 },
      { type: 'done', stop_reason: 'error_max_turns' },
    ]);
  });

  it('assistant errors become error events with runtime codes', () => {
    expect(
      mapSdkMessage({
        type: 'assistant',
        error: 'authentication_failed',
        message: { content: [] },
      }),
    ).toEqual([{ type: 'error', code: 'E_AUTH_REQUIRED', message: 'authentication_failed' }]);
    expect(
      mapSdkMessage({ type: 'assistant', error: 'rate_limit', message: { content: [] } })[0],
    ).toMatchObject({ code: 'E_RUNTIME_RATE_LIMIT' });
  });

  it('ignores system/status messages', () => {
    expect(mapSdkMessage({ type: 'system', subtype: 'init' })).toEqual([]);
  });

  it('agentErrorFrom classifies exceptions', () => {
    expect(agentErrorFrom(new Error('Invalid API key · Please run /login'))).toMatchObject({
      code: 'E_AUTH_REQUIRED',
    });
    expect(agentErrorFrom(new Error('429 rate limit exceeded'))).toMatchObject({
      code: 'E_RUNTIME_RATE_LIMIT',
    });
    expect(agentErrorFrom(new Error('boom'))).toMatchObject({
      type: 'error',
      code: 'E_INTERNAL',
      message: 'boom',
    });
  });
});
