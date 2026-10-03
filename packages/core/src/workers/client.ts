import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { SfError } from '../errors.js';
import { Logger } from '../log.js';

interface Pending {
  resolve(v: unknown): void;
  reject(e: unknown): void;
  onProgress?: (done: number, total: number) => void;
  jobId?: string;
}

const live = new Set<PythonWorker>();
process.once('exit', () => {
  for (const w of live) w.kill();
});

/**
 * Client của worker Python (D4 mục 9.3): JSON-RPC 2.0 qua stdio, một JSON mỗi dòng. Khởi động
 * lười; worker chết → lời gọi đang chờ nhận `E_PROVIDER_FAILED` (retryable), lần sau khởi động lại.
 */
export class PythonWorker {
  private child?: ChildProcessWithoutNullStreams;
  private nextId = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly logger: Logger;

  constructor(
    private readonly opts: {
      engine: string;
      python: string;
      /** Thư mục `workers/gpu/src` (đặt vào PYTHONPATH). */
      srcDir: string;
      env?: Record<string, string | undefined>;
      logger?: Logger;
    },
  ) {
    this.logger = opts.logger ?? new Logger();
  }

  get running(): boolean {
    return this.child !== undefined;
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  private ensure(): ChildProcessWithoutNullStreams {
    if (this.child) return this.child;
    const child = spawn(this.opts.python, ['-m', 'sf_worker', 'serve', '--engine', this.opts.engine], {
      env: { ...process.env, ...this.opts.env, PYTHONPATH: this.opts.srcDir, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1' },
      // cwd cố định: thư mục của tiến trình gọi có thể chứa gói trùng tên (ví dụ `coverage/`)
      cwd: this.opts.srcDir,
      windowsHide: true,
    });
    this.child = child;
    live.add(this);
    createInterface({ input: child.stdout }).on('line', (line) => this.onLine(line));
    createInterface({ input: child.stderr }).on('line', (line) =>
      this.logger.write('debug', 'worker.stderr', { engine: this.opts.engine, line }),
    );
    const fail = (e: SfError) => {
      if (this.child !== child) return;
      this.child = undefined;
      live.delete(this);
      for (const p of this.pending.values()) p.reject(e);
      this.pending.clear();
    };
    child.once('error', (e: NodeJS.ErrnoException) =>
      fail(
        e.code === 'ENOENT'
          ? new SfError('E_PROVIDER_UNAVAILABLE', `python for engine ${this.opts.engine} not found (${this.opts.python})`)
          : new SfError('E_PROVIDER_FAILED', `worker ${this.opts.engine}: ${e.message}`),
      ),
    );
    child.once('exit', (code) => fail(new SfError('E_PROVIDER_FAILED', `worker ${this.opts.engine} exited (code ${code})`)));
    return child;
  }

  private onLine(line: string): void {
    let msg: { id?: number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message: string; data?: { code?: string } } };
    try {
      msg = JSON.parse(line);
    } catch {
      this.logger.write('warn', 'worker.bad_line', { engine: this.opts.engine, line: line.slice(0, 200) });
      return;
    }
    if (msg.method === 'progress' && msg.params) {
      for (const p of this.pending.values()) {
        if (p.jobId === msg.params.job_id) p.onProgress?.(Number(msg.params.done), Number(msg.params.total));
      }
      return;
    }
    const p = msg.id === undefined ? undefined : this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id!);
    if (msg.error) p.reject(new SfError(msg.error.data?.code ?? 'E_PROVIDER_FAILED', msg.error.message));
    else p.resolve(msg.result);
  }

  call<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    extra: { jobId?: string; onProgress?: (done: number, total: number) => void } = {},
  ): Promise<T> {
    const child = this.ensure();
    const id = ++this.nextId;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, ...extra });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  }

  /** `run` của engine; hủy qua `signal` gửi `cancel {job_id}`. */
  async run(
    task: string,
    input: Record<string, unknown>,
    workdir: string,
    opts: { jobId: string; onProgress?: (done: number, total: number) => void; signal?: AbortSignal },
  ): Promise<Record<string, unknown>> {
    const onAbort = () => void this.call('cancel', { job_id: opts.jobId }).catch(() => {});
    opts.signal?.addEventListener('abort', onAbort);
    try {
      return await this.call('run', { job_id: opts.jobId, task, input, workdir }, { jobId: opts.jobId, onProgress: opts.onProgress });
    } finally {
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }

  kill(): void {
    this.child?.kill();
  }

  /** Đóng stdin (worker tự thoát), chờ tối đa 5 s rồi buộc dừng (D4: dừng ≤ 5 s). */
  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    const exited = new Promise<void>((r) => child.once('exit', () => r()));
    child.stdin.end();
    const timer = setTimeout(() => child.kill(), 5000);
    await exited;
    clearTimeout(timer);
  }
}
