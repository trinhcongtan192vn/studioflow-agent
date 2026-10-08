import { useEffect, useState } from 'react';
import type { DailyReport, LibraryEntry, PublishQueueItem, VideoCard } from '@studioflow/core';
import { mediaUrl } from './FileViewer';
import { Icon } from './Icon';
import { at } from './publish-format';
import { core } from './rpc';
import { Surface } from './Surface';
import { relativeTime, statusLabel } from './video-list-format';

type Yt = Awaited<ReturnType<typeof core.call<'publish.youtube.status'>>>;
const n = (x: number | undefined) => (x === undefined ? '—' : x.toLocaleString('vi-VN'));
const pct = (x: number | undefined) =>
  x === undefined ? '' : `${x > 0 ? '+' : ''}${Math.round(x)}%`;

/**
 * 075: Tổng quan kênh — số video cần bạn / đang làm / xong / chờ đăng, số liệu YouTube gần nhất (báo cáo ngày
 * 054), việc cần bạn, sắp đăng, render mới; lối tắt tạo video, Autopilot, cài đặt kênh.
 */
export function ChannelOverview({
  channel,
  videos,
  onOpenVideo,
  onNewVideo,
  onGo,
  onClose,
}: {
  channel: string;
  videos: VideoCard[];
  onOpenVideo: (id: string) => void;
  onNewVideo: () => void;
  onGo: (page: 'autopilot' | 'channel-settings' | 'publish' | 'library') => void;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [auto, setAuto] = useState(false);
  const [queue, setQueue] = useState<PublishQueueItem[]>([]);
  const [lib, setLib] = useState<LibraryEntry[]>([]);
  const [report, setReport] = useState<DailyReport>();
  const [yt, setYt] = useState<Yt>();
  useEffect(() => {
    const norm = (p: string) => p.replace(/[\\/]+$/, '').toLowerCase();
    void core
      .call('channels.managed', {})
      .then((r) => {
        const c = r.channels.find((x) => norm(x.path) === norm(channel));
        setName(c?.name ?? channel.split(/[\\/]/).pop() ?? channel);
        setAuto(Boolean(c?.autopilot));
      })
      .catch(() => setName(channel.split(/[\\/]/).pop() ?? channel));
    void core
      .call('publish.queue', { channel })
      .then((r) => setQueue(r.items))
      .catch(() => setQueue([]));
    void core
      .call('render.library', { channel })
      .then((r) => setLib(r.renders))
      .catch(() => setLib([]));
    void core
      .call('report.latest', { channel })
      .then((r) => setReport(r.reports[0]))
      .catch(() => setReport(undefined));
    void core
      .call('publish.youtube.status', { channel })
      .then(setYt)
      .catch(() => setYt(undefined));
  }, [channel]);

  const count = (s: VideoCard['status'][]) => videos.filter((v) => s.includes(v.status)).length;
  const needs = videos.filter((v) => v.status === 'failed' || v.status === 'waiting').slice(0, 5);
  const pending = queue.filter((q) => q.stage === 'pending');
  const y = report?.youtube;
  const stats: { label: string; value: number; tone: string; go?: () => void }[] = [
    { label: 'Cần bạn', value: count(['failed', 'waiting']), tone: 'warn' },
    { label: 'Đang làm', value: count(['running', 'paused', 'briefing']), tone: 'accent' },
    { label: 'Xong', value: count(['done']), tone: 'ok' },
    { label: 'Chờ đăng', value: pending.length, tone: 'violet', go: () => onGo('publish') },
  ];

  return (
    <Surface
      label="Tổng quan kênh"
      className="overview"
      testId="channel-overview"
      onClose={onClose}
    >
      <div className="set-top">
        <div>
          <h2>{name}</h2>
          <span className={`badge ${auto ? 'on' : 'fmt'}`}>{auto ? 'Autopilot' : 'Manual'}</span>
        </div>
        <div className="row">
          <button className="primary" onClick={onNewVideo}>
            <Icon name="plus" /> Video mới
          </button>
          <button onClick={() => onGo('autopilot')}>
            <Icon name="sparkles" /> Autopilot
          </button>
          <button className="ghost" onClick={() => onGo('channel-settings')}>
            <Icon name="settings" /> Cài đặt kênh
          </button>
        </div>
      </div>

      <div className="ov-stats">
        {stats.map((s) => (
          <button
            key={s.label}
            className={`ov-stat ${s.tone}`}
            onClick={s.go ?? onClose}
            data-testid="overview-stat"
          >
            <span className="ov-num">{s.value}</span>
            <span className="ov-label">{s.label}</span>
          </button>
        ))}
      </div>

      <div className="ov-grid">
        <section className="set-section">
          <h3>YouTube</h3>
          {!yt?.connected ? (
            <>
              <p className="muted">
                Chưa kết nối — kết nối để Autopilot đăng video và lấy số liệu.
              </p>
              <button onClick={() => onGo('channel-settings')}>Kết nối YouTube</button>
            </>
          ) : !y?.metrics_day ? (
            <p className="muted">
              Đã kết nối{yt.channel_title ? ` (${yt.channel_title})` : ''}. Chưa có số liệu — báo
              cáo ngày lập mỗi sáng (YouTube trễ 1–3 ngày).
            </p>
          ) : (
            <>
              <div className="ov-kpis">
                <div>
                  <span className="ov-num">{n(y.views)}</span>
                  <span className="ov-label">
                    lượt xem {pct(y.views_change_pct) && <em>{pct(y.views_change_pct)}</em>}
                  </span>
                </div>
                <div>
                  <span className="ov-num">{n(y.watch_minutes)}</span>
                  <span className="ov-label">phút xem</span>
                </div>
                <div>
                  <span className="ov-num">
                    {y.subs_gained === undefined
                      ? '—'
                      : `${(y.subs_gained ?? 0) - (y.subs_lost ?? 0) >= 0 ? '+' : ''}${(y.subs_gained ?? 0) - (y.subs_lost ?? 0)}`}
                  </span>
                  <span className="ov-label">người đăng ký</span>
                </div>
              </div>
              <p className="muted">Ngày {y.metrics_day}.</p>
              {y.top_videos.length > 0 && (
                <ol className="ov-top">
                  {y.top_videos.slice(0, 3).map((v) => (
                    <li key={v.title}>
                      {v.title} <span className="muted">· {n(v.views)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
          {report?.tomorrow && <p className="muted">Ngày mai: {report.tomorrow}</p>}
        </section>

        <section className="set-section">
          <h3>Cần bạn</h3>
          {!needs.length ? (
            <p className="muted">Không có video nào đang chờ bạn.</p>
          ) : (
            <ul className="ov-list">
              {needs.map((v) => (
                <li key={v.id} className={`st-${v.status}`}>
                  <button className="link" onClick={() => onOpenVideo(v.id)}>
                    <b>{v.title}</b>
                    <span className="vc-status">{statusLabel(v)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="set-section">
          <h3>Sắp đăng</h3>
          {!pending.length ? (
            <p className="muted">Không có video chờ đăng.</p>
          ) : (
            <ul className="ov-list">
              {pending.slice(0, 4).map((q) => (
                <li key={`${q.date}/${q.item_id}`}>
                  <button className="link" onClick={() => onGo('publish')}>
                    <b>{q.title}</b>
                    <span className="muted">{q.publish_at ? at(q.publish_at) : 'chưa có giờ'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="set-section">
          <h3>Render gần đây</h3>
          {!lib.length ? (
            <p className="muted">Chưa có bản render nào.</p>
          ) : (
            <ul className="ov-renders">
              {lib.slice(0, 4).map((r) => (
                <li key={`${r.video_id}/${r.render_id}`}>
                  <button className="link" onClick={() => onGo('library')}>
                    <span className="vc-thumb">
                      {r.thumbnail ? (
                        <img src={mediaUrl(r.thumbnail)} alt="" loading="lazy" />
                      ) : (
                        <Icon name="film" size={16} />
                      )}
                    </span>
                    <span>
                      <b>{r.title}</b>
                      <span className="muted">
                        {r.mode === 'release' ? 'Phát hành' : 'Nháp'} ·{' '}
                        {relativeTime(r.finished_at)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </Surface>
  );
}
