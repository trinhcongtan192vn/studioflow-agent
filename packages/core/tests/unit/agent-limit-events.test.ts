// 095 FR-AG-95-01: subscription limit may arrive as a successful SDK result.
import { expect, it } from 'vitest';
import { agentErrorFrom, mapSdkMessage } from '../../src/agent/events.js';
import { SfError } from '../../src/errors.js';

it('maps a Claude subscription notice to a limit error, never a successful completion', () => {
  expect(
    mapSdkMessage({
      type: 'result',
      subtype: 'success',
      result: "You've hit your weekly limit · resets 8am",
      usage: { output_tokens: 0 },
    }),
  ).toEqual([
    {
      type: 'error',
      code: 'E_RUNTIME_RATE_LIMIT',
      message: "You've hit your weekly limit · resets 8am",
    },
  ]);
});

it('preserves a typed quota error even when its message contains no limit keywords', () => {
  expect(agentErrorFrom(new SfError('E_RUNTIME_RATE_LIMIT', 'Try tomorrow'))).toEqual({
    type: 'error',
    code: 'E_RUNTIME_RATE_LIMIT',
    message: 'Try tomorrow',
  });
});
