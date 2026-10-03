#!/usr/bin/env node
// 006 FR-010 — cài môi trường Python cho một engine (dev). Trình cài chính thức (tiến độ, hồ sơ) là 014.
//   node scripts/setup-engine.mjs omnivoice
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ENGINES = {
  omnivoice: {
    python: '3.12',
    steps: [
      [
        'torch==2.8.0+cu128',
        'torchaudio==2.8.0+cu128',
        '--extra-index-url',
        'https://download.pytorch.org/whl/cu128',
        '--index-strategy',
        'unsafe-best-match',
      ],
      ['omnivoice==0.2.1'],
    ],
  },
};

const engine = process.argv[2];
const spec = ENGINES[engine];
if (!spec) {
  console.error(`usage: setup-engine.mjs <${Object.keys(ENGINES).join('|')}>`);
  process.exit(2);
}
const appData = process.env.SF_APP_DATA ?? path.join(process.env.APPDATA, 'StudioFlow');
const env = path.join(appData, 'providers', 'python', engine);
const py = path.join(env, 'Scripts', 'python.exe');
const run = (args) => {
  console.log(`> uv ${args.join(' ')}`);
  const r = spawnSync('uv', args, { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};
if (!existsSync(py)) run(['venv', env, '--python', spec.python]);
for (const pkgs of spec.steps) run(['pip', 'install', '--python', py, ...pkgs]);
run(['pip', 'freeze', '--python', py]);
console.log(`engine ${engine} ready: ${py}`);
