import {
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  type WriteStream,
} from 'node:fs';
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

/**
 * Ghi file ngoài project: đầu ra adapter trong `RunContext.workdir` hoặc dữ liệu tiến trình engine trong
 * app-data (cấu hình, log). Dữ liệu kênh/video luôn đi qua `WriteStore`.
 */
export function writeOutsideProject(file: string, content: string | Buffer): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

export function ensureOutsideDirs(...dirs: string[]): void {
  for (const d of dirs) mkdirSync(d, { recursive: true });
}

/** Log tiến trình engine (ví dụ `comfy.log` trong app-data). */
export function logStream(file: string): WriteStream {
  mkdirSync(path.dirname(file), { recursive: true });
  return createWriteStream(file);
}
