import { SfError } from '../errors.js';
import type { ComfyWorkflow } from './workflow.js';

export interface ComfyImageRef {
  filename: string;
  subfolder: string;
  type: string;
}

/**
 * Client HTTP/WS của một tiến trình ComfyUI (D4 mục 9.2, FN-018 mục 2): `/prompt`, tiến độ qua
 * `/ws?clientId=`, kết quả `/history` + `/view`, hủy `/interrupt` + `/queue`, giải phóng `/free`.
 */
export class ComfyClient {
  readonly clientId = `sf-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;

  constructor(readonly baseUrl: string) {}

  private async post(p: string, body: unknown): Promise<Response> {
    return fetch(`${this.baseUrl}${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  async stats(
    timeoutMs = 5000,
  ): Promise<{ devices?: { vram_total: number; vram_free: number }[] }> {
    const r = await fetch(`${this.baseUrl}/system_stats`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) throw new Error(`system_stats HTTP ${r.status}`);
    return (await r.json()) as { devices?: { vram_total: number; vram_free: number }[] };
  }

  /** Đưa ảnh vào thư mục input của ComfyUI; trả tên dùng cho `LoadImage`. */
  async upload(buf: Buffer, name: string): Promise<string> {
    const fd = new FormData();
    fd.append('image', new Blob([new Uint8Array(buf)]), name);
    fd.append('overwrite', 'true');
    const r = await fetch(`${this.baseUrl}/upload/image`, { method: 'POST', body: fd });
    if (!r.ok) throw new SfError('E_PROVIDER_FAILED', `ComfyUI upload failed: HTTP ${r.status}`);
    const j = (await r.json()) as { name: string; subfolder?: string };
    return j.subfolder ? `${j.subfolder}/${j.name}` : j.name;
  }

  async submit(prompt: ComfyWorkflow): Promise<string> {
    const r = await this.post('/prompt', { prompt, client_id: this.clientId });
    const j = (await r.json().catch(() => ({}))) as {
      prompt_id?: string;
      error?: { message?: string };
      node_errors?: Record<string, { errors?: { message: string; details?: string }[] }>;
    };
    if (!r.ok || !j.prompt_id) {
      const nodes = Object.entries(j.node_errors ?? {})
        .flatMap(([id, n]) =>
          (n.errors ?? []).map(
            (e) => `node ${id}: ${e.message}${e.details ? ` (${e.details})` : ''}`,
          ),
        )
        .join('; ');
      throw new SfError(
        'E_PROVIDER_FAILED',
        `ComfyUI rejected the workflow: ${j.error?.message ?? `HTTP ${r.status}`}${nodes ? ` — ${nodes}` : ''}`,
      );
    }
    return j.prompt_id;
  }

  /**
   * Chờ prompt xong: tiến độ qua WebSocket (nếu kết nối được), kết quả bằng thăm dò `/history` mỗi
   * `pollMs`. Hủy → `/interrupt` + xóa khỏi hàng đợi, trả `E_JOB_CANCELED` ngay.
   */
  async wait(
    promptId: string,
    opts: {
      signal?: AbortSignal;
      onProgress?: (done: number, total: number) => void;
      pollMs?: number;
    } = {},
  ): Promise<{ images: ComfyImageRef[] }> {
    let ws: WebSocket | undefined;
    try {
      ws = new WebSocket(`${this.baseUrl.replace(/^http/, 'ws')}/ws?clientId=${this.clientId}`);
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return;
        try {
          const m = JSON.parse(ev.data) as {
            type: string;
            data: { value: number; max: number; prompt_id?: string };
          };
          if (m.type === 'progress' && (!m.data.prompt_id || m.data.prompt_id === promptId))
            opts.onProgress?.(m.data.value, m.data.max);
        } catch {
          /* bỏ qua tin không phải JSON */
        }
      };
      ws.onerror = () => {};
    } catch {
      ws = undefined;
    }
    try {
      for (;;) {
        if (opts.signal?.aborted) {
          await this.cancel(promptId);
          throw new SfError('E_JOB_CANCELED', 'image job canceled');
        }
        const r = await fetch(`${this.baseUrl}/history/${promptId}`);
        const h = (await r.json()) as Record<
          string,
          {
            status?: {
              status_str?: string;
              completed?: boolean;
              messages?: [string, Record<string, unknown>][];
            };
            outputs?: Record<string, { images?: ComfyImageRef[] }>;
          }
        >;
        const e = h[promptId];
        if (e?.status?.status_str === 'error') {
          const msg = e.status.messages?.find(([t]) => t === 'execution_error')?.[1] as
            { exception_message?: string; node_type?: string } | undefined;
          const text = msg?.exception_message ?? 'execution error';
          throw new SfError(
            /out of memory|OutOfMemory/i.test(text) ? 'E_GPU_OOM' : 'E_PROVIDER_FAILED',
            `ComfyUI ${msg?.node_type ?? ''}: ${text}`.trim(),
          );
        }
        if (e?.status?.completed) {
          const images = Object.values(e.outputs ?? {}).flatMap((o) => o.images ?? []);
          if (images.length === 0)
            throw new SfError('E_PROVIDER_FAILED', 'ComfyUI returned no image');
          return { images };
        }
        await sleep(opts.pollMs ?? 500, opts.signal);
      }
    } finally {
      ws?.close();
    }
  }

  async view(img: ComfyImageRef): Promise<Buffer> {
    const q = new URLSearchParams({
      filename: img.filename,
      subfolder: img.subfolder,
      type: img.type,
    });
    const r = await fetch(`${this.baseUrl}/view?${q}`);
    if (!r.ok) throw new SfError('E_PROVIDER_FAILED', `ComfyUI view failed: HTTP ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  }

  async cancel(promptId: string): Promise<void> {
    await Promise.allSettled([
      this.post('/interrupt', { prompt_id: promptId }),
      this.post('/queue', { delete: [promptId] }),
    ]);
  }

  async free(): Promise<void> {
    await this.post('/free', { unload_models: true, free_memory: true });
  }
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}
