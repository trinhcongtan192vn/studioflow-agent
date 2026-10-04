import { currentTraceparent, withSpan } from '../trace/trace.js';
import { EventEmitter } from 'node:events';
import { errorRegistry } from '../contracts/errors.js';
import type { JobInfo } from '../contracts/types.js';
import { newId } from '../domain/ids.js';
import { isSfError, SfError } from '../errors.js';
import type { Db } from '../store/db.js';
import type { GpuLease, GpuScheduler } from './gpu.js';

/** Job trong hàng đợi: `JobInfo` (D4 mục 5) + dữ liệu nội bộ. */
export type QueuedJob = JobInfo & { payload?: unknown; parent_id?: string; channel_dir?: string };

export interface JobContext {
  signal: AbortSignal;
  progress(done: number, total: number, message?: string): void;
  /** Tạo job con và chờ chúng xong; kết quả cha tính `partial` khi có con lỗi. */
  spawnChildren(specs: EnqueueSpec[]): Promise<QueuedJob[]>;
  /** Đặt kết quả cuối khác `succeeded` mà không ném lỗi (ví dụ graph.build có nút lỗi). */
  outcome(status: 'partial' | 'failed'): void;
}

export interface JobKind {
  engine?: string;
  /** Chạy lại an toàn sau khi app tắt giữa chừng (D4 mục 5 khôi phục). */
  idempotent: boolean;
  run(job: QueuedJob, ctx: JobContext): Promise<unknown>;
  /** Gọi khi khôi phục đánh dấu job không idempotent là `E_JOB_INTERRUPTED` (ví dụ render, 013). */
  onInterrupted?(job: QueuedJob): void;
}

export interface EnqueueSpec {
  kind: string;
  video_id?: string;
  channel_dir?: string;
  payload?: unknown;
  priority?: 0 | 1 | 2;
  max_attempts?: number;
  /** Chưa chạy trước N ms (cửa sổ gom thay đổi lẻ, 019). */
  not_before_ms?: number;
}

const TERMINAL = new Set(['succeeded', 'failed', 'canceled', 'partial']);
const retryable = new Map<string, boolean>(errorRegistry.errors.map((e) => [e.code, e.retryable]));
const now = () => new Date().toISOString();

interface Row {
  id: string;
  info: string;
  payload: string | null;
  parent_id: string | null;
  channel_dir: string | null;
  idempotent: number;
}

/**
 * Hàng đợi job bền (D4 mục 5): lưu SQLite, thử lại lỗi retryable có backoff, hủy, job con,
 * khôi phục khi khởi động. Chọn job: ưu tiên → engine vừa chạy → thứ tự tạo; một job mỗi engine.
 */
export class JobQueue extends EventEmitter {
  private readonly kinds = new Map<string, JobKind>();
  private readonly running = new Map<string, AbortController>();
  private readonly engineBusy = new Set<string>();
  private readonly notBefore = new Map<string, number>();
  private lastEngine?: string;
  private started = false;
  private timer?: NodeJS.Timeout;
  private seq = 0;
  private readonly order = new Map<string, number>();
  private readonly backoff: number[];
  private readonly maxParallel: number;

  constructor(
    private readonly opts: {
      db: Db;
      backoffMs?: number[];
      maxParallel?: number;
      gpu?: GpuScheduler;
    },
  ) {
    super();
    this.backoff = opts.backoffMs ?? [2000, 10_000]; // tech-defaults mục 3
    this.maxParallel = opts.maxParallel ?? 4;
    // lease GPU được trả (kể cả từ lời gọi provider ngoài hàng đợi) → thử chạy job đang chờ (019)
    opts.gpu?.on('released', () => this.schedule());
  }

  define(kind: string, def: JobKind): void {
    this.kinds.set(kind, def);
    this.schedule();
  }

  /** Ngữ cảnh trace lúc xếp job (tool/bước) → span `sf.job` là con của nó (D11). */
  private readonly traceparents = new Map<string, string>();

  enqueue(kind: string, spec: Omit<EnqueueSpec, 'kind'> & { parent_id?: string } = {}): QueuedJob {
    const def = this.kinds.get(kind);
    const ids = new Set(this.list({}).map((j) => j.id));
    const job: QueuedJob = {
      id: newId('jb', ids) as JobInfo['id'] & string,
      kind,
      ...(spec.video_id ? { video_id: spec.video_id as JobInfo['video_id'] } : {}),
      status: 'queued',
      progress: { done: 0, total: 0 },
      ...(def?.engine ? { engine: def.engine } : {}),
      priority: spec.priority ?? 1,
      attempts: 0,
      max_attempts: spec.max_attempts ?? 3,
      created_at: now(),
      ...(spec.payload === undefined ? {} : { payload: spec.payload }),
      ...(spec.parent_id ? { parent_id: spec.parent_id } : {}),
      ...(spec.channel_dir ? { channel_dir: spec.channel_dir } : {}),
    };
    this.order.set(job.id, this.seq++);
    if (spec.not_before_ms) this.notBefore.set(job.id, Date.now() + spec.not_before_ms);
    this.save(job, def?.idempotent ?? true);
    const tp = currentTraceparent();
    if (tp) this.traceparents.set(job.id, tp);
    this.schedule();
    return job;
  }

  get(id: string): QueuedJob | undefined {
    const row = this.opts.db
      .prepare(
        'SELECT id, info, payload, parent_id, channel_dir, idempotent FROM jobs WHERE id = ?',
      )
      .get(id) as Row | undefined;
    return row ? this.fromRow(row) : undefined;
  }

  list(filter: { status?: string; video_id?: string }): QueuedJob[] {
    const rows = this.opts.db
      .prepare(
        'SELECT id, info, payload, parent_id, channel_dir, idempotent FROM jobs ORDER BY created_at, rowid',
      )
      .all() as unknown as Row[];
    return rows
      .map((r) => this.fromRow(r))
      .filter(
        (j) =>
          (!filter.status || j.status === filter.status) &&
          (!filter.video_id || j.video_id === filter.video_id),
      );
  }

  /** Đổi payload job còn `queued` (gộp mục tiêu `graph.build`, 019); trả false nếu đã chạy. */
  updatePayload(id: string, payload: unknown): boolean {
    const job = this.get(id);
    if (!job || job.status !== 'queued' || this.running.has(id)) return false;
    job.payload = payload;
    this.opts.db
      .prepare('UPDATE jobs SET payload = ? WHERE id = ?')
      .run(JSON.stringify(payload), id);
    return true;
  }

  cancel(id: string): QueuedJob {
    const job = this.get(id);
    if (!job) throw new SfError('E_ID_UNKNOWN', `job ${id} not found`);
    if (TERMINAL.has(job.status)) return job;
    const ctrl = this.running.get(id);
    if (ctrl) ctrl.abort();
    else
      this.finish(job, 'canceled', {
        error: { code: 'E_JOB_CANCELED', message: 'canceled', retryable: false },
      });
    for (const child of this.list({}).filter((j) => j.parent_id === id && j.status === 'queued'))
      this.cancel(child.id);
    return this.get(id)!;
  }

  /** Chờ job kết thúc; hết thời gian → trả trạng thái hiện tại. */
  wait(id: string, timeoutMs = 60_000): Promise<QueuedJob> {
    const current = this.get(id);
    if (!current) return Promise.reject(new SfError('E_ID_UNKNOWN', `job ${id} not found`));
    if (TERMINAL.has(current.status)) return Promise.resolve(current);
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.off('job.updated', onUpdate);
        resolve(this.get(id)!);
      };
      const onUpdate = (j: JobInfo) => {
        if (j.id === id && TERMINAL.has(j.status)) done();
      };
      const timer = setTimeout(done, timeoutMs);
      this.on('job.updated', onUpdate);
    });
  }

  /** Chờ tới khi không còn job queued/running của các loại đã định nghĩa. */
  async idle(timeoutMs = 60_000): Promise<void> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const busy = this.list({}).some(
        (j) => (j.status === 'queued' || j.status === 'running') && this.kinds.has(j.kind),
      );
      if (!busy) return;
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  /** Khôi phục sau khi `core` khởi động (D4 mục 5, NFR-02). Trả số job được xử lý. */
  recover(): number {
    const rows = this.opts.db
      .prepare(
        "SELECT id, info, payload, parent_id, channel_dir, idempotent FROM jobs WHERE status = 'running'",
      )
      .all() as unknown as Row[];
    for (const r of rows) {
      const job = this.fromRow(r);
      if (r.idempotent) {
        job.status = 'queued';
        this.save(job, true);
      } else {
        this.finish(job, 'failed', {
          error: {
            code: 'E_JOB_INTERRUPTED',
            message: 'app closed while the job was running',
            retryable: false,
          },
        });
        try {
          this.kinds.get(job.kind)?.onInterrupted?.(job);
        } catch {
          /* dọn trạng thái phụ là cố gắng tối đa */
        }
      }
    }
    return rows.length;
  }

  start(): void {
    this.started = true;
    this.schedule();
  }

  stop(): void {
    this.started = false;
    if (this.timer) clearTimeout(this.timer);
  }

  // ---------- nội bộ ----------

  private fromRow(r: Row): QueuedJob {
    const info = JSON.parse(r.info) as QueuedJob;
    if (r.payload) info.payload = JSON.parse(r.payload);
    if (r.parent_id) info.parent_id = r.parent_id;
    if (r.channel_dir) info.channel_dir = r.channel_dir;
    return info;
  }

  private save(job: QueuedJob, idempotent?: boolean): void {
    const { payload, parent_id, channel_dir, ...info } = job;
    const idem = idempotent ?? this.kinds.get(job.kind)?.idempotent ?? true;
    this.opts.db
      .prepare(
        `INSERT INTO jobs (id, kind, video_id, channel_dir, status, engine, priority, idempotent, parent_id, payload, info, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET status = excluded.status, info = excluded.info, updated_at = excluded.updated_at`,
      )
      .run(
        job.id,
        job.kind,
        job.video_id ?? null,
        channel_dir ?? null,
        job.status,
        job.engine ?? null,
        job.priority,
        idem ? 1 : 0,
        parent_id ?? null,
        payload === undefined ? null : JSON.stringify(payload),
        JSON.stringify(info),
        job.created_at,
        now(),
      );
    this.emit('job.updated', structuredClone(info));
  }

  private finish(job: QueuedJob, status: JobInfo['status'], extra: Partial<JobInfo> = {}): void {
    Object.assign(job, extra, { status, finished_at: now() });
    this.save(job);
  }

  private schedule(): void {
    if (!this.started) return;
    setImmediate(() => this.tick());
  }

  private tick(): void {
    if (!this.started) return;
    const t = Date.now();
    const candidates = this.list({ status: 'queued' })
      .filter((j) => this.kinds.has(j.kind) && (this.notBefore.get(j.id) ?? 0) <= t)
      .sort(
        (a, b) =>
          b.priority - a.priority ||
          Number(b.engine !== undefined && b.engine === this.lastEngine) -
            Number(a.engine !== undefined && a.engine === this.lastEngine) ||
          a.created_at.localeCompare(b.created_at) ||
          (this.order.get(a.id) ?? 0) - (this.order.get(b.id) ?? 0),
      );
    for (const job of candidates) {
      let lease: GpuLease | undefined;
      if (job.engine) {
        if (this.engineBusy.has(job.engine)) continue;
        // lịch GPU (D4 mục 6): engine GPU không vừa → chờ, không chiếm chỗ
        if (this.opts.gpu?.isGpu(job.engine)) {
          lease = this.opts.gpu.tryAcquire(job.engine);
          if (!lease) continue;
        }
      } else if (
        [...this.running.keys()].filter((id) => !this.get(id)?.engine).length >= this.maxParallel
      )
        continue;
      void this.run(job, lease);
    }
    const waits = [...this.notBefore.values()].filter((v) => v > t);
    if (waits.length) {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this.tick(), Math.min(...waits) - t + 1);
    }
  }

  private async run(job: QueuedJob, lease?: GpuLease): Promise<void> {
    const def = this.kinds.get(job.kind)!;
    const ctrl = new AbortController();
    this.running.set(job.id, ctrl);
    if (job.engine) {
      this.engineBusy.add(job.engine);
      this.lastEngine = job.engine;
    }
    this.notBefore.delete(job.id);
    job.status = 'running';
    job.attempts += 1;
    job.started_at = now();
    this.save(job);
    let outcome: 'partial' | 'failed' | undefined;
    const children: QueuedJob[] = [];
    const ctx: JobContext = {
      signal: ctrl.signal,
      progress: (done, total, message) => {
        job.progress = { done, total, ...(message ? { message } : {}) };
        this.save(job);
      },
      spawnChildren: async (specs) => {
        const kids = specs.map((s) => this.enqueue(s.kind, { ...s, parent_id: job.id }));
        job.children = [...(job.children ?? []), ...kids.map((k) => k.id)];
        this.save(job);
        const done = await Promise.all(kids.map((k) => this.wait(k.id, 24 * 3600_000)));
        children.push(...done);
        return done;
      },
      outcome: (s) => {
        outcome = s;
      },
    };
    try {
      await lease?.ready;
      const parent = this.traceparents.get(job.id);
      this.traceparents.delete(job.id);
      const result = await withSpan(
        'sf.job',
        {
          'sf.job_id': job.id,
          'sf.kind': job.kind,
          'sf.engine': job.engine,
          'sf.video_id': job.video_id,
        },
        () => def.run(job, ctx),
        parent,
      );
      if (ctrl.signal.aborted) throw new SfError('E_JOB_CANCELED', 'canceled');
      const failedKids = children.filter((c) => c.status !== 'succeeded').length;
      const status =
        outcome ??
        (failedKids === 0 ? 'succeeded' : failedKids === children.length ? 'failed' : 'partial');
      this.finish(job, status, result === undefined ? {} : { result });
    } catch (e) {
      if (ctrl.signal.aborted) {
        this.finish(job, 'canceled', {
          error: { code: 'E_JOB_CANCELED', message: 'canceled', retryable: false },
        });
      } else {
        const code = isSfError(e) ? e.code : 'E_INTERNAL';
        const err = {
          code,
          message: String((e as Error)?.message ?? e).split('\n')[0]!,
          retryable: retryable.get(code) ?? false,
        };
        if (err.retryable && job.attempts < job.max_attempts) {
          job.status = 'queued';
          job.error = err;
          this.notBefore.set(
            job.id,
            Date.now() + this.backoff[Math.min(job.attempts - 1, this.backoff.length - 1)]!,
          );
          this.save(job);
        } else {
          this.finish(job, 'failed', { error: err });
        }
      }
    } finally {
      this.running.delete(job.id);
      if (job.engine) this.engineBusy.delete(job.engine);
      lease?.release();
      this.schedule();
    }
  }
}
