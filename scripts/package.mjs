#!/usr/bin/env node
// 001 FR-016 — đóng gói chỉ khi verify xanh; sinh release/StudioFlow-Setup-<version>.exe.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const verify = spawnSync(process.execPath, ['scripts/verify.mjs'], {
  cwd: root,
  stdio: 'inherit',
  env,
});
if (verify.status !== 0) {
  console.error('package: refusing to package because `npm run verify` is not green');
  process.exit(1);
}
const builder = path.join(root, 'node_modules', 'electron-builder', 'cli.js');
const r = spawnSync(process.execPath, [builder, '--win', 'nsis', '--x64', '--publish', 'never'], {
  cwd: path.join(root, 'apps/desktop'),
  stdio: 'inherit',
  env,
});
process.exit(r.status ?? 1);
