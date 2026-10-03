import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Thư mục tạm riêng cho một lần chạy adapter (`RunContext.workdir`, D4 mục 4.2) — nằm ngoài
 * project; đầu ra được đưa vào project qua module ghi.
 */
export function createScratchDir(prefix = 'sf-run-'): { dir: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
