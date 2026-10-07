import {
  context,
  propagation,
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
} from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
import {
  ExportResultCode,
  W3CTraceContextPropagator,
  type ExportResult,
} from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  SimpleSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
  type SpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { maskSecrets } from '../log.js';
import type { Db } from '../store/db.js';

const hr = (t: [number, number]) => t[0] * 1000 + t[1] / 1e6;

/** Giá (D11 mục 3, `settings.pricing`) cho chi phí ước tính. */
export type Pricing = { provider: string; model: string; unit: string; usd: number }[];

/** Span đang mở: cha + thuộc tính (tìm bước/video của span dùng tài nguyên khi nó kết thúc, 028). */
const open = new Map<string, { parent?: string; attrs: Attributes; at: number }>();

class OpenSpanTracker implements SpanProcessor {
  onStart(span: Span): void {
    const r = span as unknown as ReadableSpan;
    open.set(r.spanContext().spanId, {
      parent: r.parentSpanContext?.spanId,
      attrs: r.attributes,
      at: Date.now(),
    });
  }
  onEnd(): void {}
  async forceFlush(): Promise<void> {}
  async shutdown(): Promise<void> {}
}

function inherited(spanId: string | undefined, key: string): unknown {
  for (let id = spanId, n = 0; id && n < 64; n++) {
    const o = open.get(id);
    if (!o) return undefined;
    if (o.attrs[key] !== undefined) return o.attrs[key];
    id = o.parent;
  }
  return undefined;
}

export interface UsageRow {
  kind: 'llm' | 'image_api' | 'gpu';
  provider: string | null;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  units: number;
  cost_usd: number;
  source: 'reported' | 'estimated';
}

/** Bản ghi chi phí từ một span đã kết thúc (D11 mục 3): cùng nguồn với trace → báo cáo khớp trace (AC-M3-04). */
export function usageOf(s: ReadableSpan, pricing: Pricing = []): UsageRow[] {
  const a = s.attributes;
  const num = (k: string) => Number(a[k] ?? 0) || 0;
  const str = (k: string) => (a[k] === undefined ? null : String(a[k]));
  if (s.name === 'sf.text.call' || s.name === 'sf.agent.session') {
    const tin = num('gen_ai.usage.input_tokens');
    const tout = num('gen_ai.usage.output_tokens');
    if (!tin && !tout && !num('sf.cost_usd')) return [];
    return [
      {
        kind: 'llm',
        provider: str('gen_ai.system') ?? (s.name === 'sf.agent.session' ? 'claude' : null),
        model: str('gen_ai.request.model'),
        input_tokens: tin,
        output_tokens: tout,
        units: 0,
        cost_usd: num('sf.cost_usd'),
        source: 'reported',
      },
    ];
  }
  if (s.name === 'sf.provider.run' && a['sf.from_cache'] === false) {
    const out: UsageRow[] = [];
    const provider = str('sf.provider');
    const model = str('sf.model');
    if (num('sf.gpu_ms') > 0)
      out.push({
        kind: 'gpu',
        provider,
        model,
        input_tokens: 0,
        output_tokens: 0,
        units: Math.round(num('sf.gpu_ms')) / 1000,
        cost_usd: 0,
        source: 'reported',
      });
    if (a['sf.cost_kind'] === 'per_image') {
      const price = pricing.find(
        (p) => p.unit === 'image' && p.provider === provider && (!model || p.model === model),
      );
      out.push({
        kind: 'image_api',
        provider,
        model,
        input_tokens: 0,
        output_tokens: 0,
        units: num('sf.units') || 1,
        cost_usd: Math.round((price?.usd ?? 0) * (num('sf.units') || 1) * 1e6) / 1e6,
        source: 'estimated',
      });
    }
    return out;
  }
  return [];
}

/** Exporter ghi span vào bảng `spans` của `studioflow.db` (tech-defaults: exporter tự viết, D11 mục 1). */
class SqliteExporter implements SpanExporter {
  readonly sinks = new Map<Db, { pricing: () => Pricing }>();
  export(spans: ReadableSpan[], done: (r: ExportResult) => void): void {
    for (const [db, sink] of this.sinks) {
      try {
        const st = db.prepare(
          'INSERT OR REPLACE INTO spans (span_id, trace_id, parent_id, name, start_ms, end_ms, status, status_message, video_id, attrs, events) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        );
        const us = db.prepare(
          'INSERT INTO usage (ts, channel_id, video_id, step_id, kind, provider, model, input_tokens, output_tokens, units, cost_usd, source, span_id, trace_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        );
        for (const s of spans) {
          const ctx = s.spanContext();
          const attrs = JSON.parse(maskSecrets(JSON.stringify(s.attributes))) as Attributes;
          // chi phí theo video → bước (028): bước/video lấy từ span tổ tiên còn mở
          const parent = s.parentSpanContext?.spanId;
          const pick = (k: string) =>
            (attrs[k] as string | undefined) ??
            (inherited(parent, k) as string | undefined) ??
            null;
          for (const u of usageOf(s, sink.pricing()))
            us.run(
              new Date(hr(s.endTime)).toISOString(),
              pick('sf.channel_id'),
              pick('sf.video_id'),
              pick('sf.step_id'),
              u.kind,
              u.provider,
              u.model,
              u.input_tokens,
              u.output_tokens,
              u.units,
              u.cost_usd,
              u.source,
              ctx.spanId,
              ctx.traceId,
            );
          st.run(
            ctx.spanId,
            ctx.traceId,
            s.parentSpanContext?.spanId ?? null,
            s.name,
            hr(s.startTime),
            hr(s.endTime),
            s.status.code === SpanStatusCode.ERROR ? 'error' : 'ok',
            s.status.message ?? null,
            (attrs['sf.video_id'] as string | undefined) ?? null,
            JSON.stringify(attrs),
            JSON.stringify(
              s.events.map((e) => ({ name: e.name, t: hr(e.time), attrs: e.attributes ?? {} })),
            ),
          );
        }
      } catch {
        /* E_TRACE_STORE: không chặn việc chính (D11 mục 5) */
      }
    }
    for (const s of spans) open.delete(s.spanContext().spanId);
    // span mồ côi (không bao giờ kết thúc) → dọn sau 1 ngày
    if (open.size > 10_000)
      for (const [id, o] of open) if (Date.now() - o.at > 86_400_000) open.delete(id);
    done({ code: ExportResultCode.SUCCESS });
  }
  async shutdown(): Promise<void> {}
}

const exporter = new SqliteExporter();

/** Xuất thêm sang Phoenix cục bộ khi bật (D11 mục 1, FR-OB-04; OTLP HTTP — tech-defaults). */
class PhoenixProcessor implements SpanProcessor {
  inner?: BatchSpanProcessor;
  url?: string;
  onStart(): void {}
  onEnd(span: ReadableSpan): void {
    this.inner?.onEnd(span);
  }
  async forceFlush(): Promise<void> {
    await this.inner?.forceFlush();
  }
  async shutdown(): Promise<void> {
    await this.inner?.shutdown();
  }
}
const phoenix = new PhoenixProcessor();

export const PHOENIX_URL = 'http://127.0.0.1:6006';

/** Bật/tắt xuất span sang Phoenix (`settings.trace.phoenix_enabled`). */
export function setPhoenixExport(enabled: boolean, base = PHOENIX_URL): void {
  install();
  const url = `${base}/v1/traces`;
  if (enabled && phoenix.url === url) return;
  void phoenix.inner?.shutdown();
  phoenix.inner = undefined;
  phoenix.url = undefined;
  if (!enabled) return;
  phoenix.inner = new BatchSpanProcessor(new OTLPTraceExporter({ url }), {
    scheduledDelayMillis: 500,
  });
  phoenix.url = url;
}

/** Đẩy span đang chờ sang Phoenix (test, đóng app). */
export async function flushPhoenix(): Promise<void> {
  await phoenix.forceFlush();
}
let installed = false;

/** Cài provider OTel toàn cục một lần (AsyncLocalStorage để span lồng tự động). */
function install(): void {
  if (installed) return;
  installed = true;
  const provider = new BasicTracerProvider({
    spanProcessors: [new OpenSpanTracker(), new SimpleSpanProcessor(exporter), phoenix],
  });
  trace.setGlobalTracerProvider(provider);
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
}

/** Gắn DB nhận span (mỗi `createCore`); trả hàm gỡ. Dọn span quá `retentionDays`. */
export function attachTraceStore(
  db: Db,
  retentionDays = 30,
  opts: { pricing?: () => Pricing } = {},
): () => void {
  install();
  exporter.sinks.set(db, { pricing: opts.pricing ?? (() => []) });
  try {
    db.prepare('DELETE FROM spans WHERE start_ms < ?').run(Date.now() - retentionDays * 86_400_000);
  } catch {
    /* bảng mới */
  }
  return () => exporter.sinks.delete(db);
}

export const tracer = () => trace.getTracer('studioflow', '0.1.0');

/** Chạy `fn` trong span con của ngữ cảnh hiện tại; lỗi → status error + `sf.error_code`. */
export async function withSpan<T>(
  name: string,
  attrs: Record<string, unknown>,
  fn: (span: Span) => Promise<T>,
  /** `traceparent` cha khi chạy ngoài ngữ cảnh gốc (job xếp hàng từ tool/bước). */
  parent?: string,
): Promise<T> {
  const ctx = parent
    ? propagation.extract(context.active(), { traceparent: parent })
    : context.active();
  return tracer().startActiveSpan(name, { attributes: clean(attrs) }, ctx, async (span) => {
    try {
      const r = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return r;
    } catch (e) {
      const code = (e as { code?: string }).code;
      span.setStatus({
        code: SpanStatusCode.ERROR,
        message: String((e as Error).message).slice(0, 500),
      });
      if (code) span.setAttribute('sf.error_code', code);
      throw e;
    } finally {
      span.end();
    }
  });
}

/** Bỏ thuộc tính undefined/null (OTel không nhận). */
export function clean(a: Record<string, unknown>): Attributes {
  return Object.fromEntries(
    Object.entries(a).filter(([, v]) => v !== undefined && v !== null),
  ) as Attributes;
}

/** `traceparent` W3C của ngữ cảnh hiện tại (truyền xuống Agent SDK qua `TRACEPARENT`, worker qua JSON-RPC). */
export function currentTraceparent(): string | undefined {
  const carrier: Record<string, string> = {};
  propagation.inject(context.active(), carrier);
  return carrier.traceparent;
}

export interface SpanRow {
  span_id: string;
  trace_id: string;
  parent_id: string | null;
  name: string;
  start_ms: number;
  end_ms: number;
  status: string;
  status_message: string | null;
  video_id: string | null;
  attrs: Record<string, unknown>;
  events: unknown[];
}

const row = (r: Record<string, unknown>): SpanRow => ({
  ...(r as unknown as SpanRow),
  attrs: JSON.parse(r.attrs as string) as Record<string, unknown>,
  events: JSON.parse(r.events as string) as unknown[],
});

/** Danh sách trace gần nhất (span gốc) — lọc theo video. */
export function listTraces(db: Db, o: { videoId?: string; limit?: number } = {}): SpanRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM spans WHERE parent_id IS NULL ${o.videoId ? 'AND video_id = ?' : ''} ORDER BY start_ms DESC LIMIT ?`,
    )
    .all(...(o.videoId ? [o.videoId] : []), o.limit ?? 50) as Record<string, unknown>[];
  return rows.map(row);
}

/** Mọi span của một trace, kèm độ sâu theo cây (cho màn xem trace). */
export function getTrace(db: Db, traceId: string): (SpanRow & { depth: number })[] {
  const spans = (
    db.prepare('SELECT * FROM spans WHERE trace_id = ? ORDER BY start_ms').all(traceId) as Record<
      string,
      unknown
    >[]
  ).map(row);
  const byId = new Map(spans.map((s) => [s.span_id, s]));
  const depth = (s: SpanRow): number =>
    s.parent_id && byId.has(s.parent_id) ? depth(byId.get(s.parent_id)!) + 1 : 0;
  return spans.map((s) => ({ ...s, depth: depth(s) }));
}

/** 048: span phiên agent (`sf.agent.session`) của các video — nhật ký phiên cũ chưa có transcript. */
export function agentSessionSpans(db: Db, videoIds: string[], limit = 500): SpanRow[] {
  if (!videoIds.length) return [];
  const rows = db
    .prepare(
      `SELECT * FROM spans WHERE name = 'sf.agent.session' AND video_id IN (${videoIds.map(() => '?').join(',')}) ORDER BY start_ms DESC LIMIT ?`,
    )
    .all(...videoIds, limit) as Record<string, unknown>[];
  return rows.map(row);
}

/** 048: tool đã gọi trong một phiên (span `sf.tool` có `sf.session_id`). */
export function toolSpansOfSession(db: Db, sessionId: string): SpanRow[] {
  const rows = db
    .prepare(
      `SELECT * FROM spans WHERE name = 'sf.tool' AND json_extract(attrs, '$."sf.session_id"') = ? ORDER BY start_ms`,
    )
    .all(sessionId) as Record<string, unknown>[];
  return rows.map(row);
}
