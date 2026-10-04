import { EventEmitter } from 'node:events';
import { SfError } from '../errors.js';
import { withSpan } from '../trace/trace.js';

export type GpuResource = 'gpu-heavy' | 'gpu-light';

export interface GpuSchedulerOptions {
  /** Lớp tài nguyên của engine; `undefined` → không phải engine GPU (không giới hạn). */
  resourceOf(engine: string): GpuResource | undefined;
  /** `gpu.vram_budget_gb.<engine>` (D3 mục 7.2). */
  budgetOf(engine: string): number;
  /** `gpu.vram_total_gb`. */
  total(): number;
  /** Engine còn giữ VRAM sau khi chạy xong (model còn nạp) → có thể cần đẩy ra. */
  holdsVram(engine: string): boolean;
  /** `release('offload')` của provider engine đó (ComfyUI `/free`, worker Python `offload`). */
  release(engine: string): Promise<void>;
}

export interface GpuLease {
  engine: string;
  /** Xong khi các engine phải đẩy ra đã được release. */
  ready: Promise<void>;
  release(): void;
}

interface Waiter {
  engine: string;
  resolve(l: GpuLease): void;
}

/**
 * Lịch GPU (D4 mục 6, FR-OP-02): tối đa một `gpu-heavy` chạy, không cùng engine GPU nào khác;
 * `gpu-light` chạy cùng nhau khi tổng ngân sách ≤ `gpu.vram_total_gb`. Cùng engine được vào lại.
 * Engine giữ VRAM mà không vừa với engine sắp chạy → `release('offload')` trước. Phát `released`.
 */
export class GpuScheduler extends EventEmitter {
  private readonly running = new Map<string, number>();
  /** Engine đang giữ VRAM (không chạy), theo thứ tự giữ lâu nhất trước. */
  private readonly resident: string[] = [];
  private readonly waiters: Waiter[] = [];

  constructor(private readonly o: GpuSchedulerOptions) {
    super();
  }

  active(): string[] {
    return [...this.running.keys()];
  }

  isGpu(engine: string | undefined): engine is string {
    return Boolean(engine && this.o.resourceOf(engine));
  }

  private fits(engine: string): boolean {
    if (this.running.has(engine)) return true; // vào lại
    const others = [...this.running.keys()];
    if (others.length === 0) return true; // engine lớn hơn tổng vẫn chạy khi GPU trống
    if (this.o.resourceOf(engine) === 'gpu-heavy') return false;
    if (others.some((e) => this.o.resourceOf(e) === 'gpu-heavy')) return false;
    const used = others.reduce((s, e) => s + this.o.budgetOf(e), 0);
    return used + this.o.budgetOf(engine) <= this.o.total();
  }

  /** Engine đang giữ VRAM phải đẩy ra trước khi chạy `engine`. */
  private evictions(engine: string): string[] {
    const heavy = this.o.resourceOf(engine) === 'gpu-heavy';
    let used =
      [...this.running.keys()]
        .filter((e) => e !== engine)
        .reduce((s, e) => s + this.o.budgetOf(e), 0) + this.o.budgetOf(engine);
    const out: string[] = [];
    const held = this.resident.filter((e) => e !== engine && !this.running.has(e));
    for (const e of held) used += this.o.budgetOf(e);
    for (const e of held) {
      if (heavy || this.o.resourceOf(e) === 'gpu-heavy' || used > this.o.total()) {
        out.push(e);
        used -= this.o.budgetOf(e);
      }
    }
    return out;
  }

  private grant(engine: string): GpuLease {
    if (!this.isGpu(engine)) return { engine, ready: Promise.resolve(), release: () => {} };
    const evict = this.evictions(engine);
    for (const e of evict) this.resident.splice(this.resident.indexOf(e), 1);
    this.running.set(engine, (this.running.get(engine) ?? 0) + 1);
    const ready = Promise.all(evict.map((e) => this.o.release(e).catch(() => {}))).then(() => {});
    let done = false;
    return {
      engine,
      ready,
      release: () => {
        if (done) return;
        done = true;
        const n = (this.running.get(engine) ?? 1) - 1;
        if (n > 0) this.running.set(engine, n);
        else {
          this.running.delete(engine);
          if (this.o.holdsVram(engine) && !this.resident.includes(engine))
            this.resident.push(engine);
        }
        this.drain();
        this.emit('released', engine);
      },
    };
  }

  /** Cấp theo thứ tự chờ (FIFO): dừng ở người chờ đầu tiên chưa vừa để engine nặng không bị bỏ đói. */
  private drain(): void {
    while (this.waiters.length && this.fits(this.waiters[0]!.engine)) {
      const w = this.waiters.shift()!;
      w.resolve(this.grant(w.engine));
    }
  }

  /** Cấp ngay nếu vừa (không chờ ai đang xếp hàng trước); không vừa → undefined. */
  tryAcquire(engine: string | undefined): GpuLease | undefined {
    if (!engine || !this.isGpu(engine)) return this.grant(engine ?? '');
    return this.fits(engine) && (this.running.has(engine) || this.waiters.length === 0)
      ? this.grant(engine)
      : undefined;
  }

  /** Chờ tới khi vừa; hủy → `E_JOB_CANCELED`. Lease đã `ready` khi trả về. */
  async acquire(engine: string | undefined, signal?: AbortSignal): Promise<GpuLease> {
    const now = this.tryAcquire(engine);
    if (now) {
      await now.ready;
      return now;
    }
    const t0 = Date.now();
    const lease = await withSpan('sf.gpu.wait', { 'sf.engine': engine }, async (span) => {
      const l = await new Promise<GpuLease>((resolve, reject) => {
        if (signal?.aborted)
          return reject(new SfError('E_JOB_CANCELED', 'canceled while waiting for the GPU'));
        const w: Waiter = { engine: engine!, resolve };
        this.waiters.push(w);
        signal?.addEventListener(
          'abort',
          () => {
            const i = this.waiters.indexOf(w);
            if (i >= 0) {
              this.waiters.splice(i, 1);
              reject(new SfError('E_JOB_CANCELED', 'canceled while waiting for the GPU'));
            }
          },
          { once: true },
        );
      });
      span.setAttribute('sf.wait_ms', Date.now() - t0);
      return l;
    });
    await lease.ready;
    return lease;
  }
}
