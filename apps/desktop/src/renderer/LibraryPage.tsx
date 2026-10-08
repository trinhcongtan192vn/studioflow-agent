import { useEffect, useState } from 'react';
import type { LibraryEntry } from '@studioflow/core';
import { ExportDialog } from './ExportDialog';
import { mediaUrl } from './FileViewer';
import { Icon } from './Icon';
import { core } from './rpc';
import { Surface } from './Surface';
import { relativeTime } from './video-list-format';

type Filter = 'all' | 'release' | 'draft';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Tất cả' },
  { id: 'release', label: 'Phát hành' },
  { id: 'draft', label: 'Nháp' },
];
const dur = (ms?: number) =>
  ms ? `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}` : '';

/** 073: thư viện video đã render của kênh — xem, xuất, mở thư mục, mở video để sửa. */
export function LibraryPage({
  channel,
  onOpenVideo,
  onClose,
}: {
  channel: string;
  onOpenVideo: (id: string) => void;
  onClose: () => void;
}) {
  const [list, setList] = useState<LibraryEntry[] | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [playing, setPlaying] = useState<LibraryEntry>();
  const [exporting, setExporting] = useState<LibraryEntry>();
  useEffect(() => {
    void core
      .call('render.library', { channel })
      .then((r) => setList(r.renders))
      .catch(() => setList([]));
  }, [channel]);
  const shown = (list ?? []).filter((r) => filter === 'all' || r.mode === filter);
  return (
    <Surface label="Thư viện" className="library" testId="library" onClose={onClose}>
      <div className="set-top">
        <h2>Thư viện</h2>
        <div className="segmented" role="radiogroup" aria-label="Lọc bản render">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              role="radio"
              aria-checked={filter === f.id}
              className={filter === f.id ? 'active' : ''}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <p className="muted">Mọi bản render đã xong của kênh. Xuất để lưu video ra thư mục bất kỳ.</p>
      {list === null ? (
        <p className="muted">Đang tải…</p>
      ) : !shown.length ? (
        <div className="empty-state">
          <Icon name="library" size={32} />
          <p>Chưa có bản render nào{filter === 'all' ? '' : ' ở mục này'}.</p>
          <p className="muted">Render nháp hoặc phát hành ở tab Xem trước của video.</p>
        </div>
      ) : (
        <ul className="lib-grid" data-testid="library-grid">
          {shown.map((r) => (
            <li key={`${r.video_id}/${r.render_id}`} className="lib-card">
              <button
                className={`lib-media${r.format === 'vertical' ? ' vertical' : ''}`}
                aria-label={`Xem ${r.title}`}
                onClick={() => setPlaying(r)}
              >
                {r.thumbnail ? (
                  <img src={mediaUrl(r.thumbnail)} alt="" loading="lazy" />
                ) : (
                  <Icon name="film" size={28} />
                )}
                <span className="lib-play">
                  <Icon name="play" size={22} />
                </span>
                {r.duration_ms ? <span className="lib-dur">{dur(r.duration_ms)}</span> : null}
              </button>
              <div className="lib-body">
                <b className="lib-title">{r.title}</b>
                <div className="vc-meta">
                  <span className={`badge ${r.mode === 'release' ? 'on' : 'fmt'}`}>
                    {r.mode === 'release' ? 'Phát hành' : 'Nháp'}
                  </span>
                  {r.format && (
                    <span className="badge fmt">{r.format === 'vertical' ? 'Shorts' : 'Dài'}</span>
                  )}
                  <span className="muted">{relativeTime(r.finished_at)}</span>
                </div>
                <div className="row">
                  <button onClick={() => setExporting(r)}>
                    <Icon name="download" /> Xuất…
                  </button>
                  <button
                    className="ghost icon-only"
                    title="Mở thư mục chứa video"
                    aria-label="Mở thư mục chứa video"
                    onClick={() => void window.studioflow.revealFile(r.file)}
                  >
                    <Icon name="folder" />
                  </button>
                  <button className="ghost" onClick={() => onOpenVideo(r.video_id)}>
                    Mở video
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {playing && (
        <div className="modal" onClick={() => setPlaying(undefined)}>
          <div className="card player" onClick={(e) => e.stopPropagation()}>
            <div className="set-top">
              <b>{playing.title}</b>
              <button onClick={() => setPlaying(undefined)}>Đóng</button>
            </div>
            <video src={mediaUrl(playing.file)} controls autoPlay />
          </div>
        </div>
      )}
      {exporting && (
        <ExportDialog
          channel={channel}
          video={exporting.video_id}
          renderId={exporting.render_id}
          onClose={() => setExporting(undefined)}
        />
      )}
    </Surface>
  );
}
