import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { coreDir } from './helpers.js';

// Test spawn `bin/sf.mjs` cần dist mới nhất.
export default function setup(): void {
  const tsc = createRequire(import.meta.url).resolve('typescript/bin/tsc');
  execFileSync(process.execPath, [tsc, '-p', path.join(coreDir, 'tsconfig.build.json')], {
    stdio: 'inherit',
  });
}
