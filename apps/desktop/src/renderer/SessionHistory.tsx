import { useEffect, useState } from 'react';
import type { ChatLine } from '@studioflow/core';
import { core } from './rpc';
import { Surface } from './Surface';
import { groupRuns } from './chat-format';
import { Markdown, ToolGroup } from './ChatParts';
import {
  durationLabel,
  filterSessions,
  groupByDay,
  kindLabel,
  timeOf,
  type SessionRow,
} from './session-format';

type Video = { id: string; title: string };

/** 048 (FR-AP-14): vài phiên gần nhất ở sidebar; "Xem tất cả" mở nhật ký đầy đủ. */
export function RecentSessions({
  channel,
  videos,
  refreshKey,
  onOpen,
}: {
  channel: string;
  videos: Video[];
  refreshKey?: unknown;
  onOpen: (s?: SessionRow) => void;
}) {
  const [rows, setRows] = useState<SessionRow[]>([]);
  useEffect(() => {
    void core
      .call('sessions.list', { channel, limit: 6 })
      .then((r) => setRows(r.sessions))
      .catch(() => setRows([]));
  }, [channel, refreshKey]);
  const title = (v?: string) => videos.find((x) => x.id === v)?.title ?? v ?? 'Kênh';
  return (
    <div className="recent-sessions" data-testid="recent-sessions">
      <ul className="list">
        {rows.map((s) => (
          <li key={`${s.video ?? ''}|${s.id}`}>
            <button className="link" onClick={() => onOpen(s)} title={s.title}>
              <span className={`badge kind-${s.kind}`}>{kindLabel(s.kind)}</span>{' '}
              <span className="muted">
                {timeOf(s.started_at)} · {title(s.video)}
              </span>
              {s.error && <span className="error"> ⚠</span>}
            </button>
          </li>
        ))}
        {!rows.length && <li className="muted">Chưa có phiên nào.</li>}
      </ul>
      <button className="link" data-testid="open-session-history" onClick={() => onOpen()}>
        Xem tất cả lịch sử phiên →
      </button>
    </div>
  );
}

/** Nhật ký phiên đầy đủ: lọc theo video/loại, nhóm theo ngày, xem nội dung (chỉ đọc). */
export function SessionHistory({
  channel,
  videos,
  initial,
  onClose,
}: {
  channel: string;
  videos: Video[];
  initial?: SessionRow;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [video, setVideo] = useState('');
  const [kind, setKind] = useState('');
  const [sel, setSel] = useState<SessionRow | undefined>(initial);
  const [lines, setLines] = useState<ChatLine[]>([]);
  useEffect(() => {
    void core.call('sessions.list', { channel }).then((r) => setRows(r.sessions));
  }, [channel]);
  useEffect(() => {
    if (!sel) return setLines([]);
    void core
      .call('sessions.get', { channel, id: sel.id, ...(sel.video ? { video: sel.video } : {}) })
      .then((r) => setLines(r.lines))
      .catch(() => setLines([]));
  }, [channel, sel]);
  const title = (v?: string) => videos.find((x) => x.id === v)?.title ?? v ?? 'Kênh';
  const shown = filterSessions(rows, { ...(video ? { video } : {}), ...(kind ? { kind } : {}) });
  const kinds = [...new Set(rows.map((r) => r.kind))];
  return (
    <Surface
      label="Lịch sử phiên"
      className="session-history"
      testId="session-history"
      onClose={onClose}
    >
      <div className="row">
        <h2>Lịch sử phiên agent</h2>
        <select
          aria-label="Lọc theo video"
          value={video}
          onChange={(e) => setVideo(e.target.value)}
        >
          <option value="">Mọi video</option>
          {videos.map((v) => (
            <option key={v.id} value={v.id}>
              {v.title}
            </option>
          ))}
        </select>
        <select
          aria-label="Lọc theo loại phiên"
          value={kind}
          onChange={(e) => setKind(e.target.value)}
        >
          <option value="">Mọi loại</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {kindLabel(k)}
            </option>
          ))}
        </select>
        <button onClick={onClose}>Đóng</button>
      </div>
      <div className="session-split">
        <div className="session-list" data-testid="session-list">
          {groupByDay(shown).map((g) => (
            <section key={g.day}>
              <h4>{g.day}</h4>
              <ul className="list">
                {g.items.map((s) => (
                  <li key={`${s.video ?? ''}|${s.id}`} className={sel?.id === s.id ? 'active' : ''}>
                    <button className="link" onClick={() => setSel(s)}>
                      <span className={`badge kind-${s.kind}`}>{kindLabel(s.kind)}</span>{' '}
                      {timeOf(s.started_at)}
                      {s.frame_id ? ` · ${s.frame_id}` : ''}
                      <div className="muted">
                        {title(s.video)} — {s.title}
                      </div>
                      {s.error && <div className="error">{s.error}</div>}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {!shown.length && <p className="muted">Không có phiên.</p>}
        </div>
        <div className="session-view" data-testid="session-view">
          {sel ? (
            <>
              <div className="muted">
                {kindLabel(sel.kind)} · {title(sel.video)} · {timeOf(sel.started_at)}
                {durationLabel(sel.started_at, sel.ended_at)
                  ? ` · ${durationLabel(sel.started_at, sel.ended_at)}`
                  : ''}
                {sel.tokens ? ` · ${sel.tokens.toLocaleString('vi-VN')} token` : ''}
                {sel.source === 'trace' && ' · phiên cũ, chỉ còn danh sách tool từ trace'}
              </div>
              <div className="messages readonly">
                {groupRuns(lines, (l) => l.role === 'tool').map((g) =>
                  g.kind === 'tools' ? (
                    <ToolGroup key={g.items[0]!.index} lines={g.items.map((x) => x.item)} />
                  ) : (
                    <div key={g.index} className={`msg ${g.item.role}`}>
                      {g.item.role === 'assistant' ? (
                        <Markdown text={g.item.content} />
                      ) : (
                        <span className="text">{g.item.content}</span>
                      )}
                    </div>
                  ),
                )}
                {!lines.length && <p className="muted">Phiên không có nội dung.</p>}
              </div>
            </>
          ) : (
            <p className="muted">Chọn một phiên để xem lại.</p>
          )}
        </div>
      </div>
    </Surface>
  );
}
