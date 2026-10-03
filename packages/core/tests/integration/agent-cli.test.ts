// 005 · FR-010 — sf agent auth|ask (ask ở chế độ replay với bản ghi thật).
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { coreDir, runSf } from '../helpers.js';
import { fixtureChannel, fixtureVideoId } from '../domain-helpers.js';
import { LIVE_PROMPT } from '../agent-helpers.js';

describe('sf agent (005 FR-010)', () => {
  it('ask replays a recorded session', () => {
    const r = runSf(
      ['agent', 'ask', '--channel', fixtureChannel, '--video', fixtureVideoId, LIVE_PROMPT],
      {
        env: {
          SF_LLM: 'replay',
          SF_LLM_FIXTURES: path.join(coreDir, 'tests', 'fixtures', 'llm', 'agent'),
        },
      },
    );
    expect(r.stderr).toBe('');
    const out = JSON.parse(r.stdout) as { events: { type: string }[] };
    expect(out.events.at(-1)!.type).toBe('done');
  });

  it('ask without a fixture in replay mode reports the missing fixture', () => {
    const r = runSf(
      ['agent', 'ask', '--channel', fixtureChannel, '--video', fixtureVideoId, 'câu chưa ghi'],
      {
        env: {
          SF_LLM: 'replay',
          SF_LLM_FIXTURES: path.join(coreDir, 'tests', 'fixtures', 'llm', 'agent'),
        },
      },
    );
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stderr).code).toBe('E_LLM_FIXTURE_MISSING');
  });
});
