import type { ContextRef } from './context-refs';

/**
 * Cầu nối tới Studio nhúng (028, FR-CH-04): Studio (HyperFrames 0.8.115) mở máy chủ WebMCP qua
 * `postMessage` khi chạy trong iframe (`{channel: 'mcp-iframe', type: 'mcp', direction, payload}`). App là
 * client MCP tối thiểu, chỉ gọi tool đọc: `studio_frame` (mốc đầu phát) và `studio_inspect` (phần tử đang chọn).
 */
const CHANNEL = 'mcp-iframe';

export class StudioBridge {
  private seq = 0;
  private ready?: Promise<void>;
  private readonly pending = new Map<number, (v: { result?: unknown; error?: unknown }) => void>();
  private serverReady = false;
  private readonly readyWaiters: (() => void)[] = [];
  private readonly onMessage = (ev: MessageEvent) => {
    if (ev.source !== this.frame.contentWindow) return;
    const d = ev.data as { channel?: string; type?: string; direction?: string; payload?: unknown };
    if (d?.channel !== CHANNEL || d.type !== 'mcp' || d.direction !== 'server-to-client') return;
    if (d.payload === 'mcp-server-ready') {
      this.serverReady = true;
      this.readyWaiters.splice(0).forEach((w) => w());
      return;
    }
    const p = d.payload as { id?: number; result?: unknown; error?: unknown };
    if (typeof p === 'object' && p && typeof p.id === 'number') {
      this.pending.get(p.id)?.(p);
      this.pending.delete(p.id);
    }
  };

  constructor(private readonly frame: HTMLIFrameElement) {
    window.addEventListener('message', this.onMessage);
  }

  dispose(): void {
    window.removeEventListener('message', this.onMessage);
  }

  private origin(): string {
    return new URL(this.frame.src).origin;
  }

  private post(payload: unknown): void {
    this.frame.contentWindow?.postMessage(
      { channel: CHANNEL, type: 'mcp', direction: 'client-to-server', payload },
      this.origin(),
    );
  }

  private request(method: string, params: unknown, timeoutMs = 20_000): Promise<unknown> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Studio không phản hồi'));
      }, timeoutMs);
      this.pending.set(id, (m) => {
        clearTimeout(t);
        if (m.error) reject(new Error(JSON.stringify(m.error)));
        else resolve(m.result);
      });
      this.post({ jsonrpc: '2.0', id, method, params });
    });
  }

  /** Bắt tay: gửi `mcp-check-ready` tới khi Studio (đang khởi động) trả `mcp-server-ready`. */
  private waitServer(timeoutMs = 30_000): Promise<void> {
    if (this.serverReady) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const tick = setInterval(() => this.post('mcp-check-ready'), 500);
      const t = setTimeout(() => {
        clearInterval(tick);
        reject(new Error('Studio chưa sẵn sàng'));
      }, timeoutMs);
      this.readyWaiters.push(() => {
        clearInterval(tick);
        clearTimeout(t);
        resolve();
      });
      this.post('mcp-check-ready');
    });
  }

  private init(): Promise<void> {
    this.ready ??= this.waitServer()
      .then(() =>
        this.request('initialize', {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'studioflow', version: '1' },
        }),
      )
      .then(() => this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }));
    return this.ready.catch((e: unknown) => {
      this.ready = undefined;
      throw e;
    });
  }

  /** Gọi một tool đọc của Studio; trả đối tượng kết quả (`ok`, …). */
  async tool(name: string, args: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    await this.init();
    // tool đăng ký sau khi Studio mở xong dự án → thử lại khi chưa có (tối đa ~20 s)
    let raw: unknown;
    for (let i = 0; ; i++) {
      try {
        raw = await this.request('tools/call', { name, arguments: args });
        break;
      } catch (e) {
        if (i >= 40 || !/not found/i.test((e as Error).message)) throw e;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    const r = raw as {
      structuredContent?: Record<string, unknown>;
      content?: { type: string; text?: string }[];
    };
    if (r.structuredContent) return r.structuredContent;
    const text = r.content?.find((c) => c.type === 'text')?.text ?? '{}';
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { ok: false, reason: text };
    }
  }

  /** Mốc đầu phát hiện tại (ms). */
  async currentTimeMs(): Promise<number> {
    const r = await this.tool('studio_frame');
    if (r.ok === false || typeof r.time !== 'number')
      throw new Error(String(r.reason ?? 'Studio không trả mốc'));
    return Math.round(r.time * 1000);
  }

  /** Phần tử đang chọn → ngữ cảnh: `data-sf-id` → element; file frame → frame. */
  async selection(): Promise<ContextRef> {
    const r = await this.tool('studio_inspect');
    if (r.ok === false) throw new Error(String(r.reason ?? 'chưa chọn phần tử trong Studio'));
    return selectionRef(r);
  }
}

/** Kết quả `studio_inspect` → `ContextRef` (tách riêng để test). */
export function selectionRef(r: Record<string, unknown>): ContextRef {
  const attrs = (r.dataAttributes ?? {}) as Record<string, unknown>;
  const sf = attrs['data-sf-id'] ?? attrs['sf-id'] ?? attrs.sfId;
  if (typeof sf === 'string' && sf) return { kind: 'element', id: sf };
  const fr = /(fr_[0-9a-z]{8})\.html$/.exec(String(r.sourceFile ?? ''))?.[1];
  if (fr) return { kind: 'frame', id: fr };
  return { kind: 'element', id: String(r.handle ?? r.label ?? '?') };
}
