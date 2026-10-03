// 007 · US5 · FR-009 — sf ext validate, sf workflow list|state.
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runSf } from '../helpers.js';
import { copyChannel, fixtureVideoId } from '../domain-helpers.js';
import { workflowFixtures } from '../workflow-helpers.js';

const env = { SF_GPU: '0', SF_WORKFLOW_DIRS: workflowFixtures };

describe('CLI (007 FR-009)', () => {
  it('sf ext validate: valid pack', () => {
    const r = runSf(['ext', 'validate', path.join(workflowFixtures, 'demo-explainer')], { env });
    expect(r.stderr).toBe('');
    expect(JSON.parse(r.stdout)).toEqual({
      valid: true,
      id: 'demo-explainer',
      kind: 'workflow',
      errors: [],
    });
  });

  it('sf ext validate: E_STEP_ORDER', () => {
    const r = runSf(['ext', 'validate', path.join(workflowFixtures, 'bad-order')], { env });
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stderr).code).toBe('E_STEP_ORDER');
  });

  it('sf workflow list / state', () => {
    const l = JSON.parse(runSf(['workflow', 'list'], { env }).stdout) as {
      workflows: { id: string }[];
    };
    expect(l.workflows.map((w) => w.id)).toEqual(['demo-explainer', 'refine-demo']);
    // summary() có thể ghi state.json (approval mất hiệu lực) → dùng bản sao kênh
    const c = copyChannel();
    try {
      const s = JSON.parse(
        runSf(['workflow', 'state', '--channel', c.dir, '--video', fixtureVideoId], { env }).stdout,
      );
      expect(s).toMatchObject({ video_id: fixtureVideoId, phase: 'workflow' });
    } finally {
      c.cleanup();
    }
  });
});
