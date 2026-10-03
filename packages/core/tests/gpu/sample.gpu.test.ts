// 001 · FR-013 — test gắn nhãn gpu bị skip khi SF_GPU=0.
import { expect, it } from 'vitest';
import { describeGpu, gpuEnabled } from '../../src/testing/gpu.js';

describeGpu('gpu sample (001 FR-013)', () => {
  it('runs only on GPU machines', () => {
    expect(gpuEnabled()).toBe(true);
  });
});
