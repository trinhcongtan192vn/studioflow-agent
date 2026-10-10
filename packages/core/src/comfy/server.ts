import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { defaultAppDataDir } from '../config/resolve.js';
import { SfError } from '../errors.js';
import { enginePython } from '../providers/omnivoice.js';
import { killTree } from '../render/hf-render.js';
import { ensureOutsideDirs, logStream, writeOutsideProject } from '../store/scratch.js';
import { ComfyClient } from './client.js';

export interface ComfyServerOptions {
  appDataDir?: string;
  /** Thư mục cài (mặc định `<app-data>/providers/comfyui`, chứa `ComfyUI/main.py`). */
  installDir?: string;
  /** Python engine `comfyui` (mặc định `<app-data>/providers/python/comfyui`, D4 mục 9.3). */
  python?: string;
  /** input/output/temp/user của tiến trình (mặc định `<installDir>/run`). */
  runDir?: string;
  /** Kho model chung của app (mặc định `<app-data>/models`). */
  modelsDir?: string;
  /** Thay lệnh khởi động (test): `exe args… --port N`. */
  command?: { exe: string; args: string[] };
  env?: Record<string, string>;
  healthIntervalMs?: number;
  failLimit?: number;
  startTimeoutMs?: number;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

/**
 * Vòng đời ComfyUI headless (FR-OP-05, D4 mục 9.2, FN-018 mục 2): khởi động lười trên cổng tự do của
 * 127.0.0.1 với thư mục riêng của app; sức khỏe `/system_stats` mỗi 10 s, 3 lần lỗi liên tiếp →
 * khởi động lại; `stop` dừng cả cây tiến trình. Phát `restart`.
 */
export class ComfyServer extends EventEmitter {
  private proc?: ChildProcess;
  private client?: ComfyClient;
  private starting?: Promise<ComfyClient>;
  private timer?: NodeJS.Timeout;
  private failures = 0;
  private restarting = false;
  private stopped = false;
  restarts = 0;
  private readonly o: Required<Omit<ComfyServerOptions, 'command' | 'env'>> &
    Pick<ComfyServerOptions, 'command' | 'env'>;

  constructor(opts: ComfyServerOptions = {}) {
    super();
    const appDataDir = opts.appDataDir ?? defaultAppDataDir();
    const installDir = opts.installDir ?? path.join(appDataDir, 'providers', 'comfyui');
    this.o = {
      appDataDir,
      installDir,
      python: opts.python ?? enginePython('comfyui', appDataDir),
      runDir: opts.runDir ?? path.join(installDir, 'run'),
      modelsDir: opts.modelsDir ?? path.join(appDataDir, 'models'),
      healthIntervalMs: opts.healthIntervalMs ?? 10_000,
      failLimit: opts.failLimit ?? 3,
      startTimeoutMs: opts.startTimeoutMs ?? 180_000,
      command: opts.command,
      env: opts.env,
    };
  }

  get running(): boolean {
    return Boolean(this.client && this.proc && this.proc.exitCode === null);
  }

  private get mainPy(): string {
    return path.join(this.o.installDir, 'ComfyUI', 'main.py');
  }

  /** Đã cài (không khởi động tiến trình). */
  async health(): Promise<{ ok: boolean; detail?: string }> {
    if (this.o.command) return { ok: true };
    if (!existsSync(this.mainPy))
      return { ok: false, detail: `ComfyUI not installed: ${this.mainPy}` };
    if (!existsSync(this.o.python))
      return { ok: false, detail: `ComfyUI Python env not installed: ${this.o.python}` };
    return { ok: true };
  }

  /** Client của tiến trình đang chạy; chưa chạy → khởi động. */
  async ensure(): Promise<ComfyClient> {
    this.stopped = false;
    if (this.running) return this.client!;
    this.starting ??= this.start().finally(() => (this.starting = undefined));
    return this.starting;
  }

  private args(port: number): { exe: string; args: string[]; cwd: string } {
    const r = this.o.runDir;
    if (this.o.command)
      return {
        exe: this.o.command.exe,
        args: [...this.o.command.args, '--port', String(port)],
        cwd: r,
      };
    const yaml = path.join(this.o.installDir, 'extra_model_paths.yaml');
    // chỉ trỏ kho model của app (018 research R3)
    writeOutsideProject(
      yaml,
      [
        'studioflow:',
        `  base_path: ${this.o.modelsDir.replaceAll('\\', '/')}`,
        '  diffusion_models: diffusion_models',
        // Stable Audio Open (SFX, 2026-10-10) — checkpoint một file
        '  checkpoints: checkpoints',
        '  text_encoders: text_encoders',
        '  vae: vae',
        '  loras: loras',
        '',
      ].join('\n'),
    );
    return {
      exe: this.o.python,
      args: [
        this.mainPy,
        '--listen',
        '127.0.0.1',
        '--port',
        String(port),
        '--disable-auto-launch',
        '--extra-model-paths-config',
        yaml,
        '--input-directory',
        path.join(r, 'input'),
        '--output-directory',
        path.join(r, 'output'),
        '--temp-directory',
        r,
        '--user-directory',
        path.join(r, 'user'),
      ],
      cwd: path.dirname(this.mainPy),
    };
  }

  private async start(): Promise<ComfyClient> {
    const h = await this.health();
    if (!h.ok)
      throw new SfError('E_PROVIDER_UNAVAILABLE', `${h.detail}; install the "full" profile`);
    ensureOutsideDirs(...['input', 'output', 'user'].map((d) => path.join(this.o.runDir, d)));
    const port = await freePort();
    const { exe, args, cwd } = this.args(port);
    const logFile = path.join(this.o.runDir, 'comfy.log');
    const log = logStream(logFile);
    const proc = spawn(exe, args, {
      cwd,
      env: { ...process.env, PYTHONUNBUFFERED: '1', ...this.o.env },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    proc.stdout?.pipe(log);
    proc.stderr?.pipe(log);
    this.proc = proc;
    const client = new ComfyClient(`http://127.0.0.1:${port}`);
    const deadline = Date.now() + this.o.startTimeoutMs;
    for (;;) {
      if (proc.exitCode !== null) {
        const tail = existsSync(logFile) ? readFileSync(logFile, 'utf8').slice(-800) : '';
        throw new SfError(
          'E_PROVIDER_FAILED',
          `ComfyUI exited (${proc.exitCode}) while starting: ${tail}`,
        );
      }
      try {
        await client.stats(2000);
        break;
      } catch {
        if (Date.now() > deadline) {
          killTree(proc.pid!);
          throw new SfError(
            'E_PROVIDER_FAILED',
            `ComfyUI did not answer within ${this.o.startTimeoutMs} ms`,
          );
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    this.client = client;
    this.failures = 0;
    this.watch();
    return client;
  }

  private watch(): void {
    clearInterval(this.timer);
    this.timer = setInterval(() => void this.check(), this.o.healthIntervalMs);
    this.timer.unref();
  }

  private async check(): Promise<void> {
    if (this.restarting || !this.client) return;
    try {
      await this.client.stats(Math.min(5000, this.o.healthIntervalMs * 3));
      this.failures = 0;
    } catch {
      if (++this.failures < this.o.failLimit || this.stopped) return;
      this.restarting = true;
      try {
        this.kill();
        await this.ensure();
        this.restarts++;
        this.emit('restart');
      } catch (e) {
        this.emit('restart_failed', e);
      } finally {
        this.restarting = false;
      }
    }
  }

  private kill(): void {
    clearInterval(this.timer);
    if (this.proc?.pid && this.proc.exitCode === null) killTree(this.proc.pid);
    this.proc = undefined;
    this.client = undefined;
  }

  /** Lệnh của lịch GPU (D4 mục 6): giải phóng VRAM, giữ tiến trình. */
  async release(): Promise<void> {
    if (this.running) await this.client!.free();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.kill();
  }
}
