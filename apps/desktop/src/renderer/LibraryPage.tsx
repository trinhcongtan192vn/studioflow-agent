import { useCallback, useEffect, useState } from 'react';
import type { LibraryEntry } from '@studioflow/core';
import { ExportDialog } from './ExportDialog';
import { mediaUrl } from './FileViewer';
import { Icon } from './Icon';
import { core } from './rpc';
import { Surface } from './Surface';
import { libraryPage, renderDuration, type LibraryViewOptions } from './library-view';

const FORMATS = [
  { id: 'all', label: 'Tất cả' },
  { id: 'horizontal', label: 'Video' },
  { id: 'vertical', label: 'Shorts' },
] as const;

/** 097: render library as a searchable, paginated table. */
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
  const [options, setOptions] = useState<LibraryViewOptions>({ page: 1, pageSize: 10 });
  const [playing, setPlaying] = useState<LibraryEntry>();
  const [exporting, setExporting] = useState<LibraryEntry>();
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((n) => n + 1), []);
  useEffect(() => {
    setOptions({ page: 1, pageSize: 10 });
    setPlaying(undefined);
    setExporting(undefined);
  }, [channel]);
  useEffect(() => {
    let active = true;
    setList(null);
    setError('');
    void core
      .call('render.library', { channel })
      .then((r) => {
        if (active) setList(r.renders);
      })
      .catch((e: Error) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [channel, refresh]);
  const change = (patch: LibraryViewOptions) => setOptions((o) => ({ ...o, ...patch, page: 1 }));
  const view = libraryPage(list ?? [], options);
  const go = (page: number) => setOptions((o) => ({ ...o, page }));
  const format = options.format ?? 'all';
  const mode = options.mode ?? 'all';
  const newest = options.order !== 'oldest';

  return (
    <Surface label="Thư viện" className="library" testId="library" onClose={onClose}>
      <div className="set-top">
        <div>
          <h2>Thư viện video</h2>
          <p className="muted">Các bản render đã hoàn tất của kênh · {list?.length ?? '…'} bản</p>
        </div>
        <button className="ghost" onClick={reload}>
          Làm mới
        </button>
      </div>
      <div className="lib-tabs" role="tablist" aria-label="Định dạng video">
        {FORMATS.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={format === f.id}
            onClick={() => change({ format: f.id })}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="lib-toolbar">
        <label className="lib-search">
          <Icon name="search" size={18} />
          <input
            type="search"
            aria-label="Tìm video trong thư viện"
            placeholder="Tìm theo tiêu đề hoặc mã video…"
            value={options.query ?? ''}
            onChange={(e) => change({ query: e.target.value })}
          />
        </label>
        <label>
          Loại bản{' '}
          <select
            aria-label="Lọc bản render"
            value={mode}
            onChange={(e) => change({ mode: e.target.value as LibraryViewOptions['mode'] })}
          >
            <option value="all">Tất cả bản render</option>
            <option value="release">Phát hành</option>
            <option value="draft">Nháp</option>
          </select>
        </label>
        {(options.query || format !== 'all' || mode !== 'all') && (
          <button
            className="ghost"
            onClick={() => change({ query: '', format: 'all', mode: 'all' })}
          >
            Xóa bộ lọc
          </button>
        )}
      </div>
      {error ? (
        <div className="error" role="alert">
          <p>Không tải được thư viện: {error}</p>
          <button onClick={reload}>Thử lại</button>
        </div>
      ) : list === null ? (
        <p role="status" className="muted">
          Đang tải thư viện…
        </p>
      ) : (
        <>
          <div className="lib-table-scroll">
            <table
              className="lib-table"
              data-testid="library-table"
              aria-label="Danh sách bản render"
            >
              <thead>
                <tr>
                  <th scope="col" className="lib-video-col">
                    Video
                  </th>
                  <th scope="col">Loại bản</th>
                  <th scope="col">Định dạng</th>
                  <th scope="col" aria-sort={newest ? 'descending' : 'ascending'}>
                    <button
                      className="lib-sort"
                      onClick={() => change({ order: newest ? 'oldest' : 'newest' })}
                    >
                      Ngày hoàn tất <span aria-hidden="true">{newest ? '↓' : '↑'}</span>
                    </button>
                  </th>
                  <th scope="col">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {view.items.map((r) => (
                  <tr key={`${r.video_id}/${r.render_id}`} data-testid="library-row">
                    <td>
                      <div className="lib-video-cell">
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
                          {r.duration_ms !== undefined && (
                            <span className="lib-dur">{renderDuration(r.duration_ms)}</span>
                          )}
                        </button>
                        <div className="lib-video-info">
                          <button
                            className="lib-title-link"
                            onClick={() => onOpenVideo(r.video_id)}
                            title={r.title}
                          >
                            {r.title}
                          </button>
                          <span className="muted lib-render-info" title={r.render_id}>
                            {r.output_profile} · {r.render_id}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${r.mode === 'release' ? 'on' : 'fmt'}`}>
                        {r.mode === 'release' ? 'Phát hành' : 'Nháp'}
                      </span>
                    </td>
                    <td>
                      {r.format === 'vertical'
                        ? 'Shorts'
                        : r.format === 'horizontal'
                          ? 'Video ngang'
                          : '—'}
                    </td>
                    <td className="lib-date">
                      {Number.isNaN(Date.parse(r.finished_at)) ? (
                        '—'
                      ) : (
                        <>
                          <time dateTime={r.finished_at}>
                            {new Date(r.finished_at).toLocaleDateString('vi-VN')}
                          </time>
                          <span className="muted">
                            {new Date(r.finished_at).toLocaleTimeString('vi-VN', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </>
                      )}
                    </td>
                    <td>
                      <div className="lib-actions">
                        <button className="ghost" onClick={() => setExporting(r)}>
                          <Icon name="download" size={16} /> Xuất
                        </button>
                        <button
                          className="ghost icon-only"
                          title="Mở thư mục chứa video"
                          aria-label="Mở thư mục chứa video"
                          onClick={() => void window.studioflow.revealFile(r.file)}
                        >
                          <Icon name="folder" size={16} />
                        </button>
                        <button className="ghost" onClick={() => onOpenVideo(r.video_id)}>
                          Mở video
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!view.total && (
            <div className="empty-state">
              <Icon name="library" size={32} />
              <p>{list.length ? 'Không có video khớp bộ lọc.' : 'Chưa có bản render nào.'}</p>
              <p className="muted">
                {list.length
                  ? 'Thử đổi từ khóa hoặc xóa bộ lọc.'
                  : 'Render nháp hoặc phát hành ở tab Xem trước của video.'}
              </p>
            </div>
          )}
          <div className="lib-pagination" aria-label="Phân trang thư viện">
            <label>
              Số dòng mỗi trang{' '}
              <select
                value={options.pageSize ?? 10}
                onChange={(e) => change({ pageSize: Number(e.target.value) })}
              >
                {[10, 25, 50].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <span role="status" aria-live="polite">
              {view.from}–{view.to} / {view.total} bản render
            </span>
            <span className="muted">
              Trang {view.page} / {view.totalPages}
            </span>
            <div className="row">
              <button
                className="ghost"
                aria-label="Trang đầu"
                disabled={view.page === 1}
                onClick={() => go(1)}
              >
                «
              </button>
              <button
                className="ghost"
                aria-label="Trang trước"
                disabled={view.page === 1}
                onClick={() => go(view.page - 1)}
              >
                ‹
              </button>
              <button
                className="ghost"
                aria-label="Trang sau"
                disabled={view.page === view.totalPages}
                onClick={() => go(view.page + 1)}
              >
                ›
              </button>
              <button
                className="ghost"
                aria-label="Trang cuối"
                disabled={view.page === view.totalPages}
                onClick={() => go(view.totalPages)}
              >
                »
              </button>
            </div>
          </div>
        </>
      )}
      {playing && (
        <div className="modal" onClick={() => setPlaying(undefined)}>
          <div
            className="card player"
            role="dialog"
            aria-label={`Xem ${playing.title}`}
            onClick={(e) => e.stopPropagation()}
          >
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
