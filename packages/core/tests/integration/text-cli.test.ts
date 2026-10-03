// 009 · FR-010 — sf text ask (replay).
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { coreDir, runSf } from '../helpers.js';
import { fixtureChannel } from '../domain-helpers.js';

const env = {
  SF_LLM: 'replay',
  SF_LLM_FIXTURES: path.join(coreDir, 'tests', 'fixtures', 'llm', 'text'),
};

describe('sf text (009 FR-010)', () => {
  it('ask without a recorded answer fails with E_LLM_FIXTURE_MISSING', () => {
    const r = runSf(['text', 'ask', '--channel', fixtureChannel, 'câu hỏi chưa ghi'], { env });
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stderr).code).toBe('E_LLM_FIXTURE_MISSING');
  });

  it('refine run requires an existing step', () => {
    const r = runSf(
      ['refine', 'run', '--channel', fixtureChannel, '--video', 'vd_8m2pq7rt', '--step', 'nope'],
      { env },
    );
    expect(r.code).toBe(1);
  });
});
