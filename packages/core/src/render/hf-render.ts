import { spawn, spawnSync } from 'node:child_process';
import { getGpuScheduler } from '../capability/run.js';
import { SfError } from '../errors.js';
import { hfInstall } from '../hf/cli.js';

/** Dừng cả cây tiến trình (HyperFrames mở Chrome con) — S5: không để tiến trình mồ côi. */
export function killTree(pid: number): void {
  if (process.platform === 'win32')
    spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true });
  else {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch {
      process.kill(pid, 'SIGKILL');
    }
  }
}

/**
 * `hyperframes render` bản ghim (D4 `render.hf-producer`): `index.html` của video → MP4 ở `out`
 * (ngoài project). Tiến độ đọc từ dòng "NN%"; hủy qua `signal` (kill cây ≤ 5 s).
 */
export async function hfRender(
  videoDir: string,
  out: string,
  o: {
    fps: number;
    crf: number;
    signal?: AbortSignal;
    progress?: (pct: number, message?: string) => void;
  },
): Promise<{ ms: number; log: string }> {
  const { bin } = hfInstall();
  if (o.signal?.aborted) throw new SfError('E_JOB_CANCELED', 'canceled');
  // lịch GPU (019): render (Chrome + FFmpeg) là engine gpu-light `render`; vào lại nếu job render giữ lease
  const lease = await getGpuScheduler()?.acquire('render', o.signal);
  try {
    return await hfRenderInner(bin, videoDir, out, o);
  } finally {
    lease?.release();
  }
}

async function hfRenderInner(
  bin: string,
  videoDir: string,
  out: string,
  o: {
    fps: number;
    crf: number;
    signal?: AbortSignal;
    progress?: (pct: number, message?: string) => void;
  },
): Promise<{ ms: number; log: string }> {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const p = spawn(
      process.execPath,
      [bin, 'render', '.', '-o', out, '--fps', String(o.fps), '--crf', String(o.crf)],
      {
        cwd: videoDir,
        env: {
          ...process.env,
          HYPERFRAMES_NO_TELEMETRY: '1',
          HYPERFRAMES_SKIP_SKILLS: '1',
          DO_NOT_TRACK: '1',
        },
        windowsHide: true,
        detached: process.platform !== 'win32',
      },
    );
    let log = '';
    let canceled = false;
    const onAbort = () => {
      canceled = true;
      if (p.pid) killTree(p.pid);
    };
    o.signal?.addEventListener('abort', onAbort);
    const onData = (d: Buffer) => {
      const s = d.toString('utf8');
      log = (log + s).slice(-20_000);
      for (const m of s.matchAll(/(\d{1,3})%\s+([^\n\r]*)/g))
        o.progress?.(Number(m[1]), m[2]!.trim());
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('error', (e) =>
      reject(new SfError('E_PROVIDER_UNAVAILABLE', `hyperframes render: ${e.message}`)),
    );
    p.on('close', (code) => {
      o.signal?.removeEventListener('abort', onAbort);
      if (canceled) reject(new SfError('E_JOB_CANCELED', 'render canceled'));
      else if (code !== 0)
        reject(
          new SfError('E_PROVIDER_FAILED', `hyperframes render exited ${code}: ${log.slice(-800)}`),
        );
      else resolve({ ms: Date.now() - t0, log });
    });
  });
}
