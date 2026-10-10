import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { ExplorerNode, VideoCard, VideoStateSummary } from '@studioflow/core';
import { Chat } from './Chat';
import { FileViewer, mediaUrl, type ViewedFile } from './FileViewer';
import { groupVideos, relativeTime, statusLabel } from './video-list-format';
import {
  clampWidths,
  DEFAULT_WIDTHS,
  dragWidths,
  loadWidths,
  saveWidths,
  type PanelWidths,
} from './layout';
import { ExportDialog } from './ExportDialog';
import { ChannelOverview } from './ChannelOverview';
import { LibraryPage } from './LibraryPage';
import { Palette, type Command } from './Palette';
import { noticeToast } from './palette-format';
import { toast, Toasts } from './Toasts';
import { Icon, type IconName } from './Icon';
import { AsPage } from './Surface';
import { core } from './rpc';
import { AutopilotPanel } from './AutopilotPanel';
import { ChannelSettings } from './ChannelSettings';
import { ChannelsOverview } from './ChannelsOverview';
import { ChannelSwitcher } from './ChannelSwitcher';
import { RecentSessions, SessionHistory } from './SessionHistory';
import { TrashDialog } from './TrashDialog';
import type { SessionRow } from './session-format';
import { Settings } from './Settings';
import { CostTab, JobsTab, MusicTab, PreviewTab, ProgressTab, TraceTab } from './Tabs';

type Video = VideoCard;
/** So khớp đường dẫn kênh (không phân biệt hoa thường, dấu gạch; tên ngắn 8.3 coi như không biết). */
const sameDir = (a: string, b: string): boolean | undefined => {
  const n = (x: string) =>
    x
      .replace(/[\\/]+/g, '/')
      .replace(/\/$/, '')
      .toLowerCase();
  if (n(a) === n(b)) return true;
  return /~\d/.test(a + b) ? undefined : false;
};
// 068: khung app — thanh điều hướng trái, các màn mở như trang
type Page =
  | 'overview'
  | 'publish'
  | 'video'
  | 'library'
  | 'autopilot'
  | 'channels'
  | 'settings'
  | 'channel-settings'
  | 'history';
const RAIL = 64;
const RAIL_ITEMS: { page: Page; label: string; title: string; icon: IconName; testId: string }[] = [
  // 075: tổng quan kênh
  {
    page: 'overview',
    label: 'Tổng quan',
    title: 'Tổng quan kênh',
    icon: 'home',
    testId: 'nav-overview',
  },
  { page: 'video', label: 'Video', title: 'Video của kênh', icon: 'film', testId: 'nav-video' },
  // 073: thư viện video đã render
  {
    page: 'library',
    label: 'Thư viện',
    title: 'Video đã render của kênh',
    icon: 'library',
    testId: 'nav-library',
  },
  {
    page: 'autopilot',
    label: 'Autopilot',
    title: 'Kế hoạch, tiến độ và lý do chọn chủ đề của Autopilot hôm nay',
    icon: 'sparkles',
    testId: 'open-autopilot',
  },
  {
    page: 'channels',
    label: 'Kênh',
    title: 'Quản lý kênh',
    icon: 'folder',
    testId: 'nav-channels',
  },
];
// 072: Job / Trace / Chi phí gộp vào "Kỹ thuật"; "Tệp" = thư mục của video đang mở
// kênh đã mở chat mới trong lần chạy app này (mở app → màn chat mới với gợi ý, một lần mỗi kênh)
const freshChat = new Set<string>();

const TABS = ['Tiến độ', 'Xem trước', 'Tệp', 'Nhạc', 'Kỹ thuật'] as const;
const TECH = ['Job', 'Trace', 'Chi phí'] as const;

/**
 * UI-03 Giao diện chính (FN-008 mục 1; 048): mở app vào thẳng đây. Sidebar: bộ chọn kênh (thêm/tạo kênh),
 * video, lịch sử phiên agent; "Chi tiết kênh" mở cây thư mục khi cần.
 */
export function Workspace({
  channel,
  onSwitch,
}: {
  channel: string | null;
  onSwitch: (dir: string) => void;
}) {
  const [videos, setVideos] = useState<Video[]>([]);
  const [video, setVideo] = useState<string>();
  const [state, setState] = useState<VideoStateSummary>();
  const [tree, setTree] = useState<ExplorerNode>();
  // FR-WS-06: file bị sửa ngoài app (025)
  const [external, setExternal] = useState<string[]>([]);
  const [file, setFile] = useState<ViewedFile>();
  const [tab, setTab] = useState<(typeof TABS)[number]>('Tiến độ');
  // 073: bảng lệnh Ctrl+K
  const [palette, setPalette] = useState(false);
  const [tech, setTech] = useState<(typeof TECH)[number]>('Job');
  // 072: xuất video từ đầu trang video
  const [exporting, setExporting] = useState(false);
  // 068: màn đang mở trong vùng chính (thanh điều hướng trái); `video` = sidebar + chat + tab
  const [page, setPage] = useState<Page>('video');
  // 048: quản lý kênh, lịch sử phiên, chi tiết kênh (cây thư mục)
  const [history, setHistory] = useState<{ initial?: SessionRow }>({});
  const [details, setDetails] = useState(false);
  const [tick, setTick] = useState(0);
  // 070: tìm video trong danh sách
  const [query, setQuery] = useState('');
  // 064: xóa video vào thùng rác của kênh
  const [deleting, setDeleting] = useState<{ id: string; title: string } | null>(null);
  const [deleteErr, setDeleteErr] = useState('');
  const [trash, setTrash] = useState(false);
  const [trashCount, setTrashCount] = useState(0);
  // 052: màn Autopilot hôm nay
  const [pendingVideo, setPendingVideo] = useState<string | null>(null);
  // đổi số này → khung chat mở lại (sau "Chat mới")
  const [chatNonce, setChatNonce] = useState(0);
  const newChat = async () => {
    if (!channel) return;
    try {
      await core.call('chat.new', { channel });
      setChatNonce((n) => n + 1);
    } catch (e) {
      toast({ tone: 'error', text: (e as Error).message });
    }
  };
  useEffect(() => {
    if (!channel || video || freshChat.has(channel)) return;
    freshChat.add(channel);
    void newChat();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel]);
  // độ rộng cột kéo được (nhớ theo máy)
  const root = useRef<HTMLDivElement>(null);
  const total = () => (root.current?.clientWidth ?? window.innerWidth) - RAIL;
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
    if (!channel) return;
    setVideos((await core.call('video.list', { channel })).videos);
    void core
      .call('trash.list', { channel })
      .then((r) => setTrashCount(r.entries.length))
      .catch(() => setTrashCount(0));
    setTree(await core.call('explorer.tree', { channel }));
  }, [channel]);
  // 070: bước đổi trạng thái / agent trả lời xong → cập nhật thẻ video (trạng thái, tiến độ)
  useEffect(() => {
    if (!channel || !tick) return;
    const t = window.setTimeout(
      () =>
        void core
          .call('video.list', { channel })
          .then((r) => setVideos(r.videos))
          .catch(() => {}),
      400,
    );
    return () => window.clearTimeout(t);
  }, [tick, channel]);
  // đổi kênh → bỏ video đang mở (052: hoặc mở video được chọn từ màn Autopilot)
  useEffect(() => {
    setVideo(undefined);
    setState(undefined);
    setExternal([]);
    if (pendingVideo && channel) {
      const id = pendingVideo;
      setPendingVideo(null);
      setVideo(id);
      void core.call('video.open', { channel, video: id }).then((r) => setState(r.state));
    }
  }, [channel]);

  useEffect(() => {
    void reload();
    const offs = [
      core.on('workflow.updated', (s) => {
        if (s.video_id === video) setState(s);
      }),
      // 081: agent ở chat kênh tạo video → mở video đó (agent của video làm tiếp yêu cầu)
      core.on('video.created', (d) => {
        if (!channel || sameDir(d.channel, channel) === false) return;
        void reload().then(() => {
          setPage('video');
          void openVideo(d.video);
          toast({
            tone: 'success',
            text: `Agent đã tạo video "${d.title}" — đang làm tiếp trong video.`,
          });
        });
      }),
      core.on('file.external_change', (d) => {
        if (d.video === video) setExternal((x) => [...new Set([...x, d.path])]);
      }),
      // lịch sử phiên ở sidebar cập nhật khi agent trả lời xong / bước đổi trạng thái
      core.on('chat.event', (e) => {
        if (e.type === 'done') setTick((t) => t + 1);
      }),
      core.on('workflow.notice', (d) => {
        setTick((t) => t + 1);
        // 073: video khác video đang xem (hoặc đang ở trang khác) → thông báo nổi
        const n = d.line.notice;
        if (!n || d.channel !== channel || (d.video === video && pageRef.current === 'video'))
          return;
        const t = noticeToast(n, titleRef.current(d.video));
        if (t)
          toast({
            ...t,
            action: {
              label: 'Mở video',
              run: () => {
                setPage('video');
                void openVideo(d.video);
              },
            },
          });
      }),
    ];
    // Phím tắt: Ctrl+1..5 chuyển tab, Ctrl+R render nháp (FN-008 mục 5)
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return;
      // 073: Ctrl+K — bảng lệnh
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette(true);
        return;
      }
      const n = Number(e.key);
      if (n >= 1 && n <= TABS.length) setTab(TABS[n - 1]!);
      if (e.key.toLowerCase() === 'r' && video && channel) {
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

  const current = video ? videos.find((v) => v.id === video) : undefined;
  // 073: giá trị mới nhất cho trình nghe sự kiện (đăng ký theo kênh/video)
  const pageRef = useRef(page);
  pageRef.current = page;
  const titleRef = useRef((id: string) => id);
  titleRef.current = (id: string) => videos.find((v) => v.id === id)?.title ?? id;
  const commands: Command[] = [
    ...RAIL_ITEMS.map((x) => ({
      id: `page:${x.page}`,
      label: x.label,
      group: 'Trang',
      run: () => setPage(x.page),
    })),
    { id: 'page:settings', label: 'Cài đặt', group: 'Trang', run: () => setPage('settings') },
    ...(channel
      ? [
          {
            id: 'page:channel-settings',
            label: 'Cài đặt kênh',
            group: 'Trang',
            run: () => setPage('channel-settings'),
          },
          {
            id: 'page:history',
            label: 'Lịch sử phiên agent',
            group: 'Trang',
            run: () => setPage('history'),
          },
          {
            id: 'act:new',
            label: 'Tạo video mới',
            group: 'Thao tác',
            run: () => {
              setPage('video');
              setCreating('');
            },
          },
        ]
      : []),
    ...(video && channel
      ? [
          {
            id: 'act:draft',
            label: 'Render nháp video đang mở',
            group: 'Thao tác',
            hint: 'Ctrl+R',
            run: () => void core.call('render.start', { channel, video, mode: 'draft' }),
          },
          {
            id: 'act:export',
            label: 'Xuất video đang mở…',
            group: 'Thao tác',
            run: () => {
              setPage('video');
              setExporting(true);
            },
          },
        ]
      : []),
    ...TABS.map((t, i) => ({
      id: `tab:${t}`,
      label: `Tab ${t}`,
      group: 'Tab',
      hint: `Ctrl+${i + 1}`,
      run: () => {
        setPage('video');
        setTab(t);
      },
    })),
    ...videos.map((v) => ({
      id: `video:${v.id}`,
      label: v.title,
      group: 'Video',
      hint: statusLabel(v),
      run: () => {
        setPage('video');
        void openVideo(v.id);
      },
    })),
  ];
  /** Mở video ở kênh bất kỳ (kênh khác: đổi kênh rồi mở khi danh sách đã tải). */
  const openAnyVideo = (dir: string, id: string) => {
    setPage('video');
    if (dir === channel) void openVideo(id);
    else {
      setPendingVideo(id);
      onSwitch(dir);
    }
  };
  const openVideo = async (id: string) => {
    if (!channel) return;
    setVideo(id);
    setState((await core.call('video.open', { channel, video: id })).state);
  };
  // window.prompt không có trong Electron → ô nhập ngay trong danh sách video
  const [creating, setCreating] = useState<string | null>(null);
  const [createErr, setCreateErr] = useState('');
  const newVideo = async () => {
    if (!channel) return;
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
  useEffect(() => {
    if (tab === 'Tệp' && channel)
      void core
        .call('explorer.tree', { channel })
        .then(setTree)
        .catch(() => {});
  }, [tab, video, channel]);
  const view = async (p: string) => {
    if (!channel) return;
    setFile({ path: p, ...(await core.call('explorer.read', { channel, path: p })) });
  };

  return (
    <div
      className="workspace"
      ref={root}
      style={
        {
          gridTemplateColumns:
            page === 'video'
              ? `${RAIL}px ${widths.left}px 6px minmax(0, 1fr) 6px ${widths.right}px`
              : `${RAIL}px minmax(0, 1fr)`,
        } as CSSProperties
      }
    >
      <nav className="rail" aria-label="Điều hướng">
        {RAIL_ITEMS.map((x) => (
          <button
            key={x.page}
            className={
              page === x.page ||
              (x.page === 'autopilot' && page === 'publish') ||
              (x.page === 'channels' && page === 'channel-settings')
                ? 'active'
                : ''
            }
            title={x.title}
            aria-label={x.label}
            aria-current={
              page === x.page || (x.page === 'autopilot' && page === 'publish') ? 'page' : undefined
            }
            data-testid={x.testId}
            onClick={() => setPage(x.page)}
          >
            <Icon name={x.icon} size={20} />
            <span>{x.label}</span>
          </button>
        ))}
        <span className="rail-spacer" />
        <button
          className={page === 'settings' ? 'active' : ''}
          title="Cài đặt app"
          aria-label="Cài đặt app"
          aria-current={page === 'settings' ? 'page' : undefined}
          onClick={() => setPage('settings')}
        >
          <Icon name="settings" size={20} />
          <span>Cài đặt</span>
        </button>
      </nav>
      <Toasts />
      {palette && <Palette commands={commands} onClose={() => setPalette(false)} />}
      {page !== 'video' && (
        <AsPage.Provider value>
          <main className="page-host">
            {page === 'settings' && (
              <Settings {...(channel ? { channel } : {})} onClose={() => setPage('video')} />
            )}
            {page === 'channel-settings' && channel && (
              <ChannelSettings
                channel={channel}
                onClose={() => {
                  setPage('video');
                  // bộ chọn kênh hiện đúng chế độ Autopilot/Manual mới
                  setTick((t) => t + 1);
                }}
              />
            )}
            {page === 'channels' && (
              <ChannelsOverview
                current={channel}
                onOpen={(dir) => {
                  setPage('video');
                  onSwitch(dir);
                }}
                onClose={() => {
                  setPage('video');
                  setTick((t) => t + 1);
                }}
              />
            )}
            {(page === 'autopilot' || page === 'publish') && (
              <AutopilotPanel
                initialTab={page === 'publish' ? 'publish' : 'plans'}
                onClose={() => setPage('video')}
                onOpenVideo={openAnyVideo}
              />
            )}
            {page === 'overview' &&
              (channel ? (
                <ChannelOverview
                  channel={channel}
                  videos={videos}
                  onOpenVideo={(id) => {
                    setPage('video');
                    void openVideo(id);
                  }}
                  onNewVideo={() => {
                    setPage('video');
                    setCreating('');
                  }}
                  onGo={(p) => setPage(p)}
                  onClose={() => setPage('video')}
                />
              ) : (
                <p className="muted page">Mở một kênh để xem tổng quan.</p>
              ))}
            {page === 'library' &&
              (channel ? (
                <LibraryPage
                  channel={channel}
                  onOpenVideo={(id) => {
                    setPage('video');
                    void openVideo(id);
                  }}
                  onClose={() => setPage('video')}
                />
              ) : (
                <p className="muted page">Mở một kênh để xem thư viện.</p>
              ))}
            {page === 'history' && channel && (
              <SessionHistory
                channel={channel}
                videos={videos}
                {...(history.initial ? { initial: history.initial } : {})}
                onClose={() => setPage('video')}
              />
            )}
          </main>
        </AsPage.Provider>
      )}
      {page === 'video' && (
        <>
          <aside className="left">
            <div className="row sidebar-head">
              <ChannelSwitcher
                channel={channel}
                refreshKey={tick}
                onSwitch={onSwitch}
                onManage={() => setPage('channels')}
                onChannelSettings={() => setPage('channel-settings')}
              />
            </div>
            {external.length > 0 && (
              <p className="error" role="alert">
                File bị sửa ngoài app: {external.join(', ')} — app sẽ không tự ghi đè; nhờ agent
                kiểm tra hoặc dựng lại.{' '}
                <button className="link" onClick={() => setExternal([])}>
                  Ẩn
                </button>
              </p>
            )}
            {channel && (
              <div className="vl-head">
                <h3>Video</h3>
                <button
                  className="ghost icon-only"
                  data-testid="new-video"
                  title="Video mới"
                  aria-label="Video mới"
                  onClick={() => setCreating('')}
                >
                  <Icon name="plus" />
                </button>
              </div>
            )}
            {channel && videos.length > 4 && (
              <label className="vl-search">
                <Icon name="search" size={14} />
                <input
                  placeholder="Tìm video"
                  aria-label="Tìm video"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
            )}
            {!channel || creating === null ? null : (
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
            {channel && (
              <ul className="list video-cards" data-testid="video-list">
                {groupVideos(videos, query).map((g) => (
                  <Fragment key={g.label}>
                    <li className="vc-group" aria-hidden>
                      {g.label} <span>{g.items.length}</span>
                    </li>
                    {g.items.map((v) => (
                      <li
                        key={v.id}
                        className={`video-item video-card st-${v.status}${v.id === video ? ' active' : ''}`}
                      >
                        <button
                          className="vc-main"
                          aria-current={v.id === video ? 'true' : undefined}
                          onClick={() => void openVideo(v.id)}
                        >
                          <span className={`vc-thumb${v.format === 'vertical' ? ' vertical' : ''}`}>
                            {v.thumbnail ? (
                              <img src={mediaUrl(v.thumbnail)} alt="" loading="lazy" />
                            ) : (
                              <Icon name="film" size={18} />
                            )}
                          </span>
                          <span className="vc-body">
                            <span className="vc-title">{v.title}</span>
                            <span className="vc-meta">
                              {v.format && (
                                <span className="badge fmt">
                                  {v.format === 'vertical' ? 'Shorts' : 'Dài'}
                                </span>
                              )}
                              <span className="vc-status">{statusLabel(v)}</span>
                            </span>
                            {v.steps.total > 0 && (
                              <span
                                className="vc-progress"
                                title={`${v.steps.done}/${v.steps.total} bước`}
                              >
                                <span
                                  style={{ width: `${(100 * v.steps.done) / v.steps.total}%` }}
                                />
                              </span>
                            )}
                            <span className="vc-time">
                              {v.steps.total > 0 ? `${v.steps.done}/${v.steps.total} bước · ` : ''}
                              {relativeTime(v.updated_at)}
                            </span>
                          </span>
                        </button>
                        <button
                          className="ghost icon-only icon-btn"
                          title="Xóa video (vào thùng rác, khôi phục được trong 30 ngày)"
                          aria-label={`Xóa video ${v.title}`}
                          data-testid="delete-video"
                          onClick={() => {
                            setDeleteErr('');
                            setDeleting({ id: v.id, title: v.title });
                          }}
                        >
                          <Icon name="trash" size={14} />
                        </button>
                      </li>
                    ))}
                  </Fragment>
                ))}
                {!videos.length && (
                  <li className="muted vc-empty">Chưa có video. Bấm + để tạo video đầu tiên.</li>
                )}
                {videos.length > 0 && query && !groupVideos(videos, query).length && (
                  <li className="muted vc-empty">Không có video khớp “{query}”.</li>
                )}
              </ul>
            )}
            {channel && (
              <>
                <h3>Lịch sử phiên</h3>
                <RecentSessions
                  channel={channel}
                  videos={videos}
                  refreshKey={tick}
                  onOpen={(s) => {
                    setHistory(s ? { initial: s } : {});
                    setPage('history');
                  }}
                />
                <div className="sidebar-foot">
                  <button className="link" data-testid="open-trash" onClick={() => setTrash(true)}>
                    Thùng rác{trashCount ? ` (${trashCount})` : ''}
                  </button>
                  <button
                    className="link"
                    data-testid="open-channel-details"
                    onClick={() => setDetails(true)}
                  >
                    Chi tiết kênh (thư mục, tệp)…
                  </button>
                </div>
              </>
            )}
          </aside>
          <Splitter
            side="left"
            label="Đổi độ rộng sidebar"
            onDrag={(dx, start) => setWidths(dragWidths(start, 'left', dx, total()))}
            widths={widths}
            onReset={() =>
              setWidths(clampWidths({ ...widths, left: DEFAULT_WIDTHS.left }, total()))
            }
          />
          <section className="center">
            {!channel ? (
              <div className="empty-state" data-testid="no-channel">
                <h2>Chào mừng đến StudioFlow</h2>
                <p>Thêm thư mục kênh có sẵn hoặc tạo kênh mới để bắt đầu.</p>
                <button className="primary" onClick={() => setPage('channels')}>
                  Thêm hoặc tạo kênh…
                </button>
              </div>
            ) : (
              <>
                <header className="video-head">
                  <div className="vh-title">
                    <b>{current ? current.title : 'Chat kênh'}</b>
                    {current && (
                      <span className={`vh-meta st-${current.status}`}>
                        {current.format && (
                          <span className="badge fmt">
                            {current.format === 'vertical' ? 'Shorts' : 'Dài'}
                          </span>
                        )}
                        <span className="vc-status">{statusLabel(current)}</span>
                        {state && (
                          <span className="muted">
                            {state.budget.tokens_used.toLocaleString('vi-VN')} token · $
                            {state.budget.api_cost_usd.toFixed(2)}
                          </span>
                        )}
                      </span>
                    )}
                    {!current && (
                      <span className="muted vh-sub">
                        Hỏi agent về kênh, hoặc nhờ tạo video mới.
                      </span>
                    )}
                  </div>
                  {!video && (
                    <div className="vh-actions">
                      <button
                        className="ghost"
                        data-testid="new-chat"
                        onClick={() => void newChat()}
                      >
                        <Icon name="plus" /> Chat mới
                      </button>
                    </div>
                  )}
                  {video && (
                    <div className="vh-actions">
                      <button
                        className="ghost"
                        title="Mở thư mục video trong Windows"
                        onClick={() =>
                          void window.studioflow.openPath(`${channel}/videos/${video}`)
                        }
                      >
                        <Icon name="folder" /> Thư mục
                      </button>
                      <button data-testid="head-export" onClick={() => setExporting(true)}>
                        <Icon name="download" /> Xuất video
                      </button>
                    </div>
                  )}
                </header>
                {exporting && video && (
                  <ExportDialog
                    channel={channel}
                    video={video}
                    onClose={() => setExporting(false)}
                  />
                )}
                <Chat
                  key={`${channel}|${video ?? ''}|${chatNonce}`}
                  channel={channel}
                  video={video}
                  onOpenVideo={openAnyVideo}
                  onOpenFile={(rel) => void view(video ? `videos/${video}/${rel}` : rel)}
                  onOpenTab={(t) => setTab(t as (typeof TABS)[number])}
                />
              </>
            )}
          </section>
          <Splitter
            side="right"
            label="Đổi độ rộng khung tab"
            onDrag={(dx, start) => setWidths(dragWidths(start, 'right', dx, total()))}
            widths={widths}
            onReset={() =>
              setWidths(clampWidths({ ...widths, right: DEFAULT_WIDTHS.right }, total()))
            }
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
              {channel && tab === 'Tiến độ' && (
                <ProgressTab channel={channel} video={video} state={state} onState={setState} />
              )}
              {channel && tab === 'Xem trước' && <PreviewTab channel={channel} video={video} />}
              {channel && tab === 'Tệp' && (
                <VideoFiles
                  node={video ? findNode(tree, `videos/${video}`) : undefined}
                  onOpen={(p) => void view(p)}
                  onReveal={(p) => void window.studioflow.openPath(`${channel}/${p}`)}
                />
              )}
              {channel && tab === 'Nhạc' && <MusicTab channel={channel} />}
              {channel && tab === 'Kỹ thuật' && (
                <>
                  <div className="segmented tech-switch" role="tablist" aria-label="Kỹ thuật">
                    {TECH.map((t) => (
                      <button
                        key={t}
                        role="tab"
                        aria-selected={tech === t}
                        className={tech === t ? 'active' : ''}
                        onClick={() => setTech(t)}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  {tech === 'Job' && <JobsTab video={video} />}
                  {tech === 'Trace' && <TraceTab video={video} />}
                  {tech === 'Chi phí' && <CostTab channel={channel} video={video} />}
                </>
              )}
            </div>
          </aside>
        </>
      )}
      {details && channel && (
        <div className="modal" onClick={() => setDetails(false)}>
          <div
            className="card channel-details"
            role="dialog"
            aria-label="Chi tiết kênh"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>Chi tiết kênh</h2>
            <p className="muted">{channel}</p>
            <div className="explorer" data-testid="explorer">
              {tree && (
                <Tree
                  node={tree}
                  onOpen={(p) => void view(p)}
                  onReveal={(p) => void window.studioflow.openPath(`${channel}/${p}`)}
                />
              )}
            </div>
            <div className="row">
              <button onClick={() => void window.studioflow.openPath(channel)}>
                Mở thư mục trong Windows
              </button>
              <button onClick={() => setDetails(false)}>Đóng</button>
            </div>
          </div>
        </div>
      )}
      {file && channel && (
        <FileViewer channel={channel} file={file} onClose={() => setFile(undefined)} />
      )}
      {deleting && channel && (
        <div className="modal" onClick={() => setDeleting(null)}>
          <div
            className="card"
            role="alertdialog"
            aria-label="Xóa video"
            data-testid="delete-confirm"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Xóa video "{deleting.title}"?</h3>
            <p className="muted">
              Video chuyển vào Thùng rác của kênh và tự xóa hẳn sau 30 ngày. Khôi phục được trước
              đó.
            </p>
            {deleteErr && <p className="error">{deleteErr}</p>}
            <div className="row">
              <button
                className="primary"
                onClick={async () => {
                  try {
                    await core.call('video.delete', { channel, video: deleting.id });
                    if (video === deleting.id) {
                      setVideo(undefined);
                      setState(undefined);
                    }
                    setDeleting(null);
                    await reload();
                  } catch (e) {
                    setDeleteErr((e as Error).message);
                  }
                }}
              >
                Xóa
              </button>
              <button onClick={() => setDeleting(null)}>Hủy</button>
            </div>
          </div>
        </div>
      )}
      {trash && channel && (
        <TrashDialog
          channel={channel}
          onChanged={() => void reload()}
          onClose={() => setTrash(false)}
        />
      )}
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

function findNode(node: ExplorerNode | undefined, p: string): ExplorerNode | undefined {
  if (!node) return undefined;
  if (node.path === p) return node;
  for (const c of node.children ?? []) {
    if (p === c.path || p.startsWith(`${c.path}/`)) return findNode(c, p);
  }
  return undefined;
}

/** 072: tab Tệp — cây thư mục của video đang mở (chỉ đọc; chuột phải = mở thư mục trong Windows). */
function VideoFiles({
  node,
  onOpen,
  onReveal,
}: {
  node: ExplorerNode | undefined;
  onOpen: (p: string) => void;
  onReveal: (p: string) => void;
}) {
  if (!node) return <p className="muted">Chọn một video để xem tệp của nó.</p>;
  return (
    <div className="explorer video-files" data-testid="video-files">
      <p className="muted">Bấm để xem; chuột phải để mở thư mục chứa tệp trong Windows.</p>
      {node.children?.map((c) => (
        <Tree key={c.path} node={c} onOpen={onOpen} onReveal={onReveal} />
      ))}
    </div>
  );
}
