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
import {
  BasicTracerProvider,
  SimpleSpanProcessor,
  type ReadableSpan,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-base';
import { maskSecrets } from '../log.js';
import type { Db } from '../store/db.js';

const hr = (t: [number, number]) => t[0] * 1000 + t[1] / 1e6;

/** Exporter ghi span vào bảng `spans` của `studioflow.db` (tech-defaults: exporter tự viết, D11 mục 1). */
class SqliteExporter implements SpanExporter {
  readonly sinks = new Set<Db>();
  export(spans: ReadableSpan[], done: (r: ExportResult) => void): void {
    for (const db of this.sinks) {
      try {
        const st = db.prepare(
          'INSERT OR REPLACE INTO spans (span_id, trace_id, parent_id, name, start_ms, end_ms, status, status_message, video_id, attrs, events) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        );
        for (const s of spans) {
          const ctx = s.spanContext();
          const attrs = JSON.parse(maskSecrets(JSON.stringify(s.attributes))) as Attributes;
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
    done({ code: ExportResultCode.SUCCESS });
  }
  async shutdown(): Promise<void> {}
}

const exporter = new SqliteExporter();
let installed = false;

/** Cài provider OTel toàn cục một lần (AsyncLocalStorage để span lồng tự động). */
function install(): void {
  if (installed) return;
  installed = true;
  const provider = new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
  trace.setGlobalTracerProvider(provider);
  context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
}

/** Gắn DB nhận span (mỗi `createCore`); trả hàm gỡ. Dọn span quá `retentionDays`. */
export function attachTraceStore(db: Db, retentionDays = 30): () => void {
  install();
  exporter.sinks.add(db);
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
