import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ExplorerNode, VideoStateSummary } from '@studioflow/core';
import { Chat } from './Chat';
import { FileViewer, type ViewedFile } from './FileViewer';
import {
  clampWidths,
  DEFAULT_WIDTHS,
  dragWidths,
  loadWidths,
  saveWidths,
  type PanelWidths,
} from './layout';
import { core } from './rpc';
import { Settings } from './Settings';
import { CostTab, JobsTab, MusicTab, PreviewTab, ProgressTab, TraceTab } from './Tabs';

type Video = { id: string; title: string; phase: string; updated_at: string };
const TABS = ['Tiến độ', 'Xem trước', 'Job', 'Nhạc', 'Trace', 'Chi phí'] as const;

/** UI-03 Không gian kênh (FN-008 mục 1). */
export function Workspace({ channel, onClose }: { channel: string; onClose: () => void }) {
  const [videos, setVideos] = useState<Video[]>([]);
  const [video, setVideo] = useState<string>();
  const [state, setState] = useState<VideoStateSummary>();
  const [tree, setTree] = useState<ExplorerNode>();
  // FR-WS-06: file bị sửa ngoài app (025)
  const [external, setExternal] = useState<string[]>([]);
  const [file, setFile] = useState<ViewedFile>();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Tiến độ');
  const [settings, setSettings] = useState(false);
  // độ rộng cột kéo được (nhớ theo máy)
  const root = useRef<HTMLDivElement>(null);
  const total = () => root.current?.clientWidth ?? window.innerWidth;
  const [widths, setWidthsState] = useState<PanelWidths>(() =>
    clampWidths(loadWidths(), window.innerWidth),
  );
  const setWidths = (w: PanelWidths) => {
    setWidthsState(w);
    saveWidths(w);
  };
  useEffect(() => {
    const onResize = () => setWidthsState((w) => clampWidths(w, total()));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const reload = useCallback(async () => {
    setVideos((await core.call('video.list', { channel })).videos);
    setTree(await core.call('explorer.tree', { channel }));
  }, [channel]);

  useEffect(() => {
    void reload();
    const offs = [
      core.on('workflow.updated', (s) => {
        if (s.video_id === video) setState(s);
      }),
      core.on('file.external_change', (d) => {
        if (d.video === video) setExternal((x) => [...new Set([...x, d.path])]);
      }),
    ];
    // Phím tắt: Ctrl+1..5 chuyển tab, Ctrl+R render nháp (FN-008 mục 5)
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return;
      const n = Number(e.key);
      if (n >= 1 && n <= TABS.length) setTab(TABS[n - 1]!);
      if (e.key.toLowerCase() === 'r' && video) {
        e.preventDefault();
        void core.call('render.start', { channel, video, mode: 'draft' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      offs.forEach((o) => o());
      window.removeEventListener('keydown', onKey);
    };
  }, [channel, video, reload]);

  const openVideo = async (id: string) => {
    setVideo(id);
    setState((await core.call('video.open', { channel, video: id })).state);
  };
  // window.prompt không có trong Electron → ô nhập ngay trong danh sách video
  const [creating, setCreating] = useState<string | null>(null);
  const [createErr, setCreateErr] = useState('');
  const newVideo = async () => {
    try {
      const title = (creating ?? '').trim();
      const { video_id } = await core.call('video.create', {
        channel,
        ...(title ? { title } : {}),
      });
      setCreating(null);
      setCreateErr('');
      await reload();
      await openVideo(video_id);
    } catch (e) {
      setCreateErr((e as Error).message);
    }
  };
  const view = async (p: string) =>
    setFile({ path: p, ...(await core.call('explorer.read', { channel, path: p })) });

  return (
    <div
      className="workspace"
      ref={root}
      style={
        {
          gridTemplateColumns: `${widths.left}px 6px minmax(0, 1fr) 6px ${widths.right}px`,
        } as CSSProperties
      }
    >
      <aside className="left">
        <div className="row">
          <button className="link" onClick={onClose} title="Về trang chủ">
            ←
          </button>
          <b title={channel}>{channel.split(/[\\/]/).pop()}</b>
          <button className="link" onClick={() => setSettings(true)} title="Cài đặt">
            ⚙
          </button>
        </div>
        {external.length > 0 && (
          <p className="error" role="alert">
            File bị sửa ngoài app: {external.join(', ')} — app sẽ không tự ghi đè; nhờ agent kiểm
            tra hoặc dựng lại.{' '}
            <button className="link" onClick={() => setExternal([])}>
              Ẩn
            </button>
          </p>
        )}
        <h3>Video</h3>
        <ul className="list" data-testid="video-list">
          {videos.map((v) => (
            <li key={v.id} className={v.id === video ? 'active' : ''}>
              <button className="link" onClick={() => void openVideo(v.id)}>
                {v.title} <span className="muted">({v.phase})</span>
              </button>
            </li>
          ))}
        </ul>
        {creating === null ? (
          <button data-testid="new-video" onClick={() => setCreating('')}>
            + Video mới
          </button>
        ) : (
          <div className="new-video" data-testid="new-video-form">
            <input
              autoFocus
              placeholder="Tên video tạm (có thể đổi sau)"
              value={creating}
              onChange={(e) => setCreating(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void newVideo();
                if (e.key === 'Escape') setCreating(null);
              }}
            />
            <div className="row">
              <button onClick={() => void newVideo()}>Tạo</button>
              <button className="link" onClick={() => setCreating(null)}>
                Hủy
              </button>
            </div>
            {createErr && <div className="error">{createErr}</div>}
          </div>
        )}
        <h3>Explorer</h3>
        <div className="explorer" data-testid="explorer">
          {tree && (
            <Tree
              node={tree}
              onOpen={(p) => void view(p)}
              onReveal={(p) => void window.studioflow.openPath(`${channel}/${p}`)}
            />
          )}
        </div>
      </aside>
      <Splitter
        side="left"
        label="Đổi độ rộng sidebar"
        onDrag={(dx, start) => setWidths(dragWidths(start, 'left', dx, total()))}
        widths={widths}
        onReset={() => setWidths(clampWidths({ ...widths, left: DEFAULT_WIDTHS.left }, total()))}
      />
      <section className="center">
        <header className="video-head">
          <b>{video ? (videos.find((v) => v.id === video)?.title ?? video) : 'Chat kênh'}</b>
          {state && (
            <span className="muted">
              {' '}
              · {state.phase} · {state.budget.tokens_used.toLocaleString('vi-VN')} token · $
              {state.budget.api_cost_usd.toFixed(2)}
            </span>
          )}
        </header>
        <Chat
          key={`${channel}|${video ?? ''}`}
          channel={channel}
          video={video}
          onOpenFile={(rel) => void view(video ? `videos/${video}/${rel}` : rel)}
          onOpenTab={(t) => setTab(t as (typeof TABS)[number])}
        />
      </section>
      <Splitter
        side="right"
        label="Đổi độ rộng khung tab"
        onDrag={(dx, start) => setWidths(dragWidths(start, 'right', dx, total()))}
        widths={widths}
        onReset={() => setWidths(clampWidths({ ...widths, right: DEFAULT_WIDTHS.right }, total()))}
      />
      <aside className="right">
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t} className={t === tab ? 'active' : ''} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </nav>
        <div className="tab-body">
          {tab === 'Tiến độ' && (
            <ProgressTab channel={channel} video={video} state={state} onState={setState} />
          )}
          {tab === 'Xem trước' && <PreviewTab channel={channel} video={video} />}
          {tab === 'Job' && <JobsTab video={video} />}
          {tab === 'Nhạc' && <MusicTab channel={channel} />}
          {tab === 'Trace' && <TraceTab video={video} />}
          {tab === 'Chi phí' && <CostTab channel={channel} video={video} />}
        </div>
      </aside>
      {file && <FileViewer channel={channel} file={file} onClose={() => setFile(undefined)} />}
      {settings && <Settings channel={channel} onClose={() => setSettings(false)} />}
    </div>
  );
}

/** Thanh chia cột: kéo chuột, phím ←/→ (Shift: bước lớn), nhấp đúp về mặc định. */
function Splitter({
  side,
  label,
  widths,
  onDrag,
  onReset,
}: {
  side: 'left' | 'right';
  label: string;
  widths: PanelWidths;
  onDrag: (dx: number, start: PanelWidths) => void;
  onReset: () => void;
}) {
  const start = useRef<{ x: number; w: PanelWidths } | null>(null);
  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={side === 'left' ? widths.left : widths.right}
      tabIndex={0}
      title={`${label} — kéo, hoặc nhấp đúp để về mặc định`}
      data-testid={`splitter-${side}`}
      onPointerDown={(e) => {
        start.current = { x: e.clientX, w: widths };
        e.currentTarget.setPointerCapture(e.pointerId);
        document.body.classList.add('resizing');
      }}
      onPointerMove={(e) => {
        if (start.current) onDrag(e.clientX - start.current.x, start.current.w);
      }}
      onPointerUp={(e) => {
        start.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
        document.body.classList.remove('resizing');
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 64 : 16;
        if (e.key === 'ArrowLeft') onDrag(-step, widths);
        if (e.key === 'ArrowRight') onDrag(step, widths);
      }}
    />
  );
}

/** Explorer chỉ đọc (FR-WS-02): xem, mở thư mục trong Windows; không tạo/sửa/xóa. */
function Tree({
  node,
  onOpen,
  onReveal,
}: {
  node: ExplorerNode;
  onOpen: (p: string) => void;
  onReveal: (p: string) => void;
}) {
  const [open, setOpen] = useState(node.path === '' || node.path.split('/').length < 2);
  if (node.kind === 'file') {
    return (
      <div className="node">
        <button
          className="link"
          onClick={() => onOpen(node.path)}
          onContextMenu={(e) => (
            e.preventDefault(),
            onReveal(node.path.split('/').slice(0, -1).join('/'))
          )}
        >
          {node.name}
        </button>
      </div>
    );
  }
  return (
    <div className="node">
      <button className="link dir" onClick={() => setOpen(!open)}>
        {open ? '▾' : '▸'} {node.name || '/'}
      </button>
      {open && (
        <div className="children">
          {node.children?.map((c) => (
            <Tree key={c.path} node={c} onOpen={onOpen} onReveal={onReveal} />
          ))}
        </div>
      )}
    </div>
  );
}
