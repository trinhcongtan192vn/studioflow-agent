import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { ChatLine } from '../ipc/schema.js';
import type { Db } from '../store/db.js';
import type { WriteStore } from '../store/writer.js';
import { agentSessionSpans, toolSpansOfSession } from '../trace/trace.js';

/**
 * 048 (FR-AP-14): nhật ký phiên agent để xem lại (audit log) — chat chính (`chat/`, `videos/<vd>/chat/`),
 * phiên con có transcript (`videos/<vd>/sessions/`, từ 048) và phiên cũ chỉ còn trace (danh sách tool).
 */
export interface SessionEntry {
  id: string;
  kind: string;
  /** chat: lịch sử chat chính · session: nhật ký phiên con · trace: chỉ có trace (trước 048). */
  source: 'chat' | 'session' | 'trace';
  video?: string;
  frame_id?: string;
  title: string;
  started_at: string;
  ended_at?: string;
  lines: number;
  error?: string;
  tokens?: number;
}

const read = (abs: string): ChatLine[] =>
  readFileSync(abs, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as ChatLine];
      } catch {
        return [];
      }
    });

const clip = (s: string, n = 80) => {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

function videosOf(store: WriteStore): string[] {
  const d = store.abs('videos');
  return existsSync(d)
    ? readdirSync(d, { withFileTypes: true })
        .filter((e) => e.isDirectory() && /^vd_/.test(e.name))
        .map((e) => e.name)
    : [];
}

function fromFile(
  abs: string,
  source: 'chat' | 'session',
  video: string | undefined,
): SessionEntry | undefined {
  const lines = read(abs);
  if (!lines.length) return undefined;
  const head = lines.find((l) => l.session)?.session;
  const firstUser = lines.find((l) => l.role === 'user')?.content;
  const err = lines.find(
    (l) => l.role === 'system' && /^(Lỗi |E_[A-Z_]+:)/.test(l.content),
  )?.content;
  const tokens = lines.reduce(
    (n, l) => n + (l.usage ? l.usage.input_tokens + l.usage.output_tokens : 0),
    0,
  );
  const ts = lines.map((l) => l.ts).filter(Boolean);
  return {
    id: path.basename(abs, '.jsonl'),
    kind: head?.kind ?? (source === 'chat' ? 'main' : 'agent'),
    source,
    ...(video ? { video } : {}),
    ...(head?.frame_id ? { frame_id: head.frame_id } : {}),
    title: clip(firstUser ?? lines[0]!.content),
    started_at: ts[0] ?? '',
    ...(ts.length ? { ended_at: ts[ts.length - 1] } : {}),
    lines: lines.length,
    ...(err ? { error: clip(err, 200) } : {}),
    ...(tokens ? { tokens } : {}),
  };
}

/** Mọi phiên của kênh (hoặc một video), mới trước. */
export function listSessions(
  store: WriteStore,
  db: Db | undefined,
  o: { video?: string; limit?: number } = {},
): SessionEntry[] {
  const out: SessionEntry[] = [];
  const videos = o.video ? [o.video] : videosOf(store);
  const scan = (rel: string, source: 'chat' | 'session', video?: string) => {
    const dir = store.abs(rel);
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
      const e = fromFile(path.join(dir, f), source, video);
      if (e) out.push(e);
    }
  };
  if (!o.video) scan('chat', 'chat');
  for (const v of videos) {
    scan(`videos/${v}/chat`, 'chat', v);
    scan(`videos/${v}/sessions`, 'session', v);
  }
  // phiên con trước 048: chỉ còn span — vẫn liệt kê (loại, lỗi, token) để tra
  const known = new Set(out.map((e) => e.id));
  if (db)
    for (const s of agentSessionSpans(db, videos)) {
      const id = String(s.attrs['sf.session_id'] ?? '');
      const kind = String(s.attrs['sf.session_kind'] ?? 'agent');
      if (!id || known.has(id) || kind === 'main') continue;
      known.add(id);
      const err = s.attrs['sf.error'] ? String(s.attrs['sf.error']) : undefined;
      const tokens =
        Number(s.attrs['gen_ai.usage.input_tokens'] ?? 0) +
        Number(s.attrs['gen_ai.usage.output_tokens'] ?? 0);
      out.push({
        id,
        kind,
        source: 'trace',
        ...(s.video_id ? { video: s.video_id } : {}),
        title: `Phiên ${kind} (chỉ có trace)`,
        started_at: new Date(Number(s.start_ms)).toISOString(),
        ...(s.end_ms ? { ended_at: new Date(Number(s.end_ms)).toISOString() } : {}),
        lines: 0,
        ...(err ? { error: clip(err, 200) } : {}),
        ...(tokens ? { tokens } : {}),
      });
    }
  return out
    .sort((a, b) => (a.started_at < b.started_at ? 1 : a.started_at > b.started_at ? -1 : 0))
    .slice(0, o.limit ?? 300);
}

/** Nội dung một phiên: dòng chat/nhật ký; phiên chỉ có trace → dòng tổng hợp từ span tool. */
export function getSession(
  store: WriteStore,
  db: Db | undefined,
  o: { id: string; video?: string },
): ChatLine[] {
  const id = o.id.replace(/[^\w-]/g, '');
  const candidates = [
    ...(o.video
      ? [`videos/${o.video}/chat/${id}.jsonl`, `videos/${o.video}/sessions/${id}.jsonl`]
      : [`chat/${id}.jsonl`]),
  ];
  for (const rel of candidates) if (existsSync(store.abs(rel))) return read(store.abs(rel));
  if (!db) return [];
  return toolSpansOfSession(db, id).map((t) => ({
    ts: new Date(Number(t.start_ms)).toISOString(),
    role: 'tool' as const,
    content:
      t.attrs['sf.ok'] === false ? `lỗi ${String(t.attrs['sf.error_code'] ?? '')}`.trim() : 'xong',
    tool: { name: String(t.attrs['sf.tool_name'] ?? '?'), ok: t.attrs['sf.ok'] !== false },
  }));
}

/** 055: các phiên `ops` (Telegram) trong dữ liệu app — `ops/sessions/<ss>.jsonl`, mới trước. */
export function listOpsSessions(appDataDir: string, o: { limit?: number } = {}): SessionEntry[] {
  const dir = path.join(appDataDir, 'ops', 'sessions');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .flatMap((f) => {
      const e = fromFile(path.join(dir, f), 'session', undefined);
      return e ? [{ ...e, kind: 'ops' }] : [];
    })
    .sort((a, b) => (a.started_at < b.started_at ? 1 : a.started_at > b.started_at ? -1 : 0))
    .slice(0, o.limit ?? 300);
}

export function getOpsSession(appDataDir: string, id: string): ChatLine[] {
  const f = path.join(appDataDir, 'ops', 'sessions', `${id.replace(/[^\w-]/g, '')}.jsonl`);
  return existsSync(f) ? read(f) : [];
}
