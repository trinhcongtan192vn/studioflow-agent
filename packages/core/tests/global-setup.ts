import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { coreDir } from './helpers.js';

// Test spawn `bin/sf.mjs` cần dist mới nhất.
export default function setup(): void {
  const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
  execFileSync(process.execPath, [tsc, '-p', path.join(coreDir, 'tsconfig.build.json')], {
    stdio: 'inherit',
  });
  // engine audio-analysis (CPU, 012) chạy thật trong test: dùng venv của workers/gpu (uv sync)
  const venv = path.join(coreDir, '..', '..', 'workers', 'gpu', '.venv', 'Scripts', 'python.exe');
  if (!process.env.SF_PYTHON_AUDIO_ANALYSIS && existsSync(venv))
    process.env.SF_PYTHON_AUDIO_ANALYSIS = venv;
}
