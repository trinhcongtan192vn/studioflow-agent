import { useCallback, useEffect, useState } from 'react';
import type { ExplorerNode, VideoStateSummary } from '@studioflow/core';
import { Chat } from './Chat';
import { core } from './rpc';
import { Settings } from './Settings';
import { JobsTab, MusicTab, PreviewTab, ProgressTab, TraceTab } from './Tabs';

type Video = { id: string; title: string; phase: string; updated_at: string };
const TABS = ['Tiến độ', 'Xem trước', 'Job', 'Nhạc', 'Trace'] as const;

/** UI-03 Không gian kênh (FN-008 mục 1). */
export function Workspace({ channel, onClose }: { channel: string; onClose: () => void }) {
  const [videos, setVideos] = useState<Video[]>([]);
  const [video, setVideo] = useState<string>();
  const [state, setState] = useState<VideoStateSummary>();
  const [tree, setTree] = useState<ExplorerNode>();
  // FR-WS-06: file bị sửa ngoài app (025)
  const [external, setExternal] = useState<string[]>([]);
  const [file, setFile] = useState<{
    path: string;
    kind: string;
    content?: string;
    size: number;
  }>();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Tiến độ');
  const [settings, setSettings] = useState(false);

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
  const newVideo = async () => {
    const title = window.prompt('Tên video tạm') ?? '';
    const { video_id } = await core.call('video.create', { channel, title });
    await reload();
    await openVideo(video_id);
  };
  const view = async (p: string) =>
    setFile({ path: p, ...(await core.call('explorer.read', { channel, path: p })) });

  return (
    <div className="workspace">
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
        <button onClick={() => void newVideo()}>+ Video mới</button>
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
        <Chat key={`${channel}|${video ?? ''}`} channel={channel} video={video} />
      </section>
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
        </div>
      </aside>
      {file && (
        <div className="modal" onClick={() => setFile(undefined)}>
          <div className="card wide" onClick={(e) => e.stopPropagation()}>
            <div className="row">
              <b>{file.path}</b>
              <button onClick={() => setFile(undefined)}>Đóng</button>
            </div>
            {file.kind === 'binary' ? (
              <p className="muted">Tệp nhị phân, {file.size.toLocaleString('vi-VN')} byte.</p>
            ) : (
              <pre data-testid="file-content">
                {file.kind === 'json'
                  ? JSON.stringify(JSON.parse(file.content ?? 'null'), null, 2)
                  : file.content}
              </pre>
            )}
          </div>
        </div>
      )}
      {settings && <Settings channel={channel} onClose={() => setSettings(false)} />}
    </div>
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
