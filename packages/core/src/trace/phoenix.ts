import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { SfError } from '../errors.js';
import { killTree } from '../render/hf-render.js';
import { ensureOutsideDirs } from '../store/scratch.js';
import { PHOENIX_URL, setPhoenixExport } from './trace.js';

/** Phoenix đang trả lời ở `base` (tech-defaults: `phoenix serve` cục bộ, cổng 6006). */
export async function phoenixHealthy(base = PHOENIX_URL, timeoutMs = 1500): Promise<boolean> {
  try {
    const r = await fetch(`${base}/healthz`, { signal: AbortSignal.timeout(timeoutMs) });
    if (r.ok) return true;
    const r2 = await fetch(base, { signal: AbortSignal.timeout(timeoutMs) });
    return r2.status < 500;
  } catch {
    return false;
  }
}

export const phoenixExe = (appDataDir: string) =>
  path.join(appDataDir, 'providers', 'python', 'phoenix', 'Scripts', 'phoenix.exe');

/**
 * Phoenix cục bộ (FR-OB-04, D11 mục 1): đã có server ở 127.0.0.1:6006 → dùng; không thì chạy
 * `phoenix serve` của môi trường app (`sf model install phoenix-env`). Không khởi động được →
 * `E_PHOENIX_UNAVAILABLE` (không chặn app; trace vẫn lưu SQLite).
 */
export class PhoenixServer {
  private child?: ChildProcess;

  constructor(private readonly appDataDir: string) {}

  get url(): string {
    return PHOENIX_URL;
  }

  async enable(waitMs = 90_000): Promise<{ url: string; started: boolean }> {
    if (await phoenixHealthy()) {
      setPhoenixExport(true);
      return { url: PHOENIX_URL, started: false };
    }
    const exe = phoenixExe(this.appDataDir);
    if (!existsSync(exe))
      throw new SfError(
        'E_PHOENIX_UNAVAILABLE',
        'Phoenix is not installed; install it from Settings (phoenix-env) or run `phoenix serve` yourself',
      );
    const work = path.join(this.appDataDir, 'phoenix');
    ensureOutsideDirs(work);
    this.child = spawn(exe, ['serve'], {
      env: {
        ...process.env,
        PHOENIX_WORKING_DIR: work,
        PHOENIX_HOST: '127.0.0.1',
        PHOENIX_PORT: '6006',
      },
      windowsHide: true,
      stdio: 'ignore',
    });
    const end = Date.now() + waitMs;
    while (Date.now() < end) {
      if (await phoenixHealthy()) {
        setPhoenixExport(true);
        return { url: PHOENIX_URL, started: true };
      }
      if (this.child.exitCode !== null) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    this.stop();
    throw new SfError('E_PHOENIX_UNAVAILABLE', 'phoenix serve did not start on 127.0.0.1:6006');
  }

  disable(): void {
    setPhoenixExport(false);
    this.stop();
  }

  stop(): void {
    if (this.child?.pid && this.child.exitCode === null) killTree(this.child.pid);
    this.child = undefined;
  }
}
