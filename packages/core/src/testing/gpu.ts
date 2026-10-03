import { describe } from 'vitest';

/** GPU khả dụng cho test trừ khi `SF_GPU=0` (D12 mục 2, mục 7). */
export function gpuEnabled(): boolean {
  return process.env.SF_GPU !== '0';
}

/** `describe` cho test nhãn `gpu`: báo "skipped" khi `SF_GPU=0`. */
export const describeGpu: typeof describe = describe.skipIf(!gpuEnabled()) as typeof describe;
