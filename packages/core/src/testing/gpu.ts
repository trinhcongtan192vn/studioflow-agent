import { closeSync, openSync, readFileSync, rmSync, writeSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe } from 'vitest';

/** GPU khả dụng cho test trừ khi `SF_GPU=0` (D12 mục 2, mục 7). */
export function gpuEnabled(): boolean {
  return process.env.SF_GPU !== '0';
}

const LOCK = path.join(os.tmpdir(), 'studioflow-gpu-test.lock');

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Khóa GPU giữa các tiến trình test (019): mỗi file test chạy ở worker riêng nên lịch GPU trong tiến
 * trình không phối hợp được — ComfyUI (~13 GB) và OmniVoice cùng lúc sẽ tràn VRAM 16 GB.
 */
async function acquireGpuLock(): Promise<void> {
  for (;;) {
    try {
      const fd = openSync(LOCK, 'wx');
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return;
    } catch {
      let owner = 0;
      try {
        owner = Number(readFileSync(LOCK, 'utf8'));
      } catch {
        /* vừa được giải phóng */
      }
      if (owner && !alive(owner)) rmSync(LOCK, { force: true });
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}

function releaseGpuLock(): void {
  try {
    if (Number(readFileSync(LOCK, 'utf8')) === process.pid) rmSync(LOCK, { force: true });
  } catch {
    /* không giữ khóa */
  }
}

/** `describe` cho test nhãn `gpu`: báo "skipped" khi `SF_GPU=0`; giữ khóa GPU trong suốt nhóm test. */
export const describeGpu = ((name: string, fn: () => void) =>
  describe.skipIf(!gpuEnabled())(name, () => {
    beforeAll(acquireGpuLock, 60 * 60_000);
    afterAll(releaseGpuLock);
    fn();
  })) as unknown as typeof describe;
