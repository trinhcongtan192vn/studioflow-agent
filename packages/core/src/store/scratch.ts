import {
  constants,
  copyFileSync,
  createWriteStream,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  unlinkSync,
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

/** 066: sao chép file của project ra thư mục người dùng chọn — không bao giờ ghi đè (constitution 1.2). */
export function copyOutsideProject(src: string, dest: string): void {
  copyFileSync(src, dest, constants.COPYFILE_EXCL);
}

/**
 * Bản xem chỉ đọc ngoài project (027): junction thư mục `target` tại `link` trong thư mục tạm; `dispose`
 * gỡ junction trước khi xóa thư mục tạm (không đụng nội dung đích).
 */
export function linkOutsideProject(target: string, link: string): void {
  mkdirSync(path.dirname(link), { recursive: true });
  symlinkSync(target, link, 'junction');
}

export function unlinkOutsideProject(link: string): void {
  try {
    unlinkSync(link);
  } catch {
    /* không còn */
  }
}

export function ensureOutsideDirs(...dirs: string[]): void {
  for (const d of dirs) mkdirSync(d, { recursive: true });
}

/** Log tiến trình engine (ví dụ `comfy.log` trong app-data). */
export function logStream(file: string): WriteStream {
  mkdirSync(path.dirname(file), { recursive: true });
  return createWriteStream(file);
}
