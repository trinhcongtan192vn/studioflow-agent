import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { encodeWav } from '../src/index.js';
import { coreDir } from './helpers.js';

/** Python của workers/gpu (.venv của uv) — đủ cho engine `fake` (chỉ stdlib). */
export const devPython = (() => {
  const p = path.resolve(coreDir, '..', '..', 'workers', 'gpu', '.venv', 'Scripts', 'python.exe');
  return existsSync(p) ? p : 'python';
})();

export const workerSrc = path.resolve(coreDir, '..', '..', 'workers', 'gpu', 'src');

/** Ghi WAV sin (48 kHz mono 16-bit) để làm file mẫu giọng trong test. */
export function writeWav(file: string, durationMs: number): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, encodeWav(durationMs));
}
