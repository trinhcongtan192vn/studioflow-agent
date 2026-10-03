import { describe } from 'vitest';

/** Test chạy thật với LLM: chỉ khi `SF_LLM=record` (D12 mục 2, 4). */
export const describeLive: typeof describe = describe.skipIf(
  process.env.SF_LLM !== 'record',
) as typeof describe;
