// 007 · FR-001, FR-002 — semver, kiểm manifest (id trùng, after lạ, vòng, E_STEP_ORDER).
import { describe, expect, it } from 'vitest';
import {
  satisfies,
  validateManifest,
  STEP_LIBRARY,
  type WorkflowManifest,
} from '../../src/index.js';

describe('satisfies (007 FR-001)', () => {
  it.each([
    ['1.0.0', '>=1.0 <2.0', true],
    ['2.0.0', '>=1.0 <2.0', false],
    ['1.4.2', '^1.2.0', true],
    ['2.0.0', '^1.2.0', false],
    ['1.2.9', '~1.2.0', true],
    ['1.3.0', '~1.2.0', false],
    ['1.0.0', '=1.0.0', true],
    ['3.1.0', '<2.0 || >=3.0', true],
    ['0.9.0', '>=1.0', false],
  ])('%s in %s → %s', (v, r, ok) => expect(satisfies(v, r)).toBe(ok));
});

const base = (steps: WorkflowManifest['steps']): WorkflowManifest => ({
  id: 'x',
  version: '1.0.0',
  title: 'x',
  description: 'x',
  app_api: '>=1.0 <2.0',
  output_profiles: ['yt-1080p30'],
  requires: [],
  steps,
});

describe('validateManifest (007 FR-002)', () => {
  it('library covers every StepLibraryId of D6', () => {
    expect(Object.keys(STEP_LIBRARY).sort()).toEqual(
      [
        'design-system',
        'script',
        'storyboard',
        'cast',
        'voice',
        'assets',
        'frame-build',
        'animatic',
        'captions',
        'music',
        'look',
        'effects',
        'overlays',
        'lipsync',
        'finalize',
        'publish-meta',
        'render',
      ].sort(),
    );
  });

  it('accepts a well-ordered manifest', () => {
    expect(
      validateManifest(
        base([
          { id: 'script', uses: 'script', title: 's' },
          { id: 'sb', uses: 'storyboard', title: 'b' },
          { id: 'voice', uses: 'voice', title: 'v' },
          { id: 'lip', uses: 'lipsync', title: 'l' },
          { id: 'frames', uses: 'frame-build', title: 'f' },
          { id: 'music', uses: 'music', title: 'm' },
        ]),
      ),
    ).toEqual([]);
  });

  it('reports duplicate ids, unknown after, cycles', () => {
    const errs = validateManifest(
      base([
        { id: 'a', uses: 'script', title: 'a' },
        { id: 'a', uses: 'storyboard', title: 'b' },
        { id: 'c', uses: 'voice', title: 'c', after: ['nope'] },
      ]),
    ).map((e) => e.message);
    expect(errs.some((m) => m.includes('duplicate step id a'))).toBe(true);
    expect(errs.some((m) => m.includes('unknown step nope'))).toBe(true);
    const cyc = validateManifest(
      base([
        { id: 'a', uses: 'script', title: 'a', after: ['b'] },
        { id: 'b', uses: 'storyboard', title: 'b', after: ['a'] },
      ]),
    );
    expect(cyc.some((e) => e.message.includes('cycle'))).toBe(true);
  });

  it('E_STEP_ORDER when a step reads data written only by a later step', () => {
    const errs = validateManifest(
      base([
        { id: 'script', uses: 'script', title: 's' },
        { id: 'sb', uses: 'storyboard', title: 'b' },
        { id: 'frames', uses: 'frame-build', title: 'f' },
        { id: 'lip', uses: 'lipsync', title: 'l' },
      ]),
    );
    expect(errs).toEqual([
      expect.objectContaining({ code: 'E_STEP_ORDER', message: expect.stringContaining('frames') }),
    ]);
    const screenplay = validateManifest(
      base([
        { id: 'script', uses: 'script', title: 's', params: { mode: 'screenplay' } },
        { id: 'cast', uses: 'cast', title: 'c' },
      ]),
    );
    expect(screenplay[0]).toMatchObject({ code: 'E_STEP_ORDER' });
  });
});
