import { useEffect, useRef, useState } from 'react';
import type { DailyPlan, PlanJobResult } from '@studioflow/core';
import { core } from './rpc';
import { AsPage, Surface } from './Surface';
import { ChannelSettings } from './ChannelSettings';
import { PublishReview } from './PublishReview';
import { itemStatusLabel, itemSummary, statusLine } from './autopilot-view';
import { timeOf } from './session-format';

type Status = Awaited<ReturnType<typeof core.call<'autopilot.status'>>>;
type Plans = Awaited<ReturnType<typeof core.call<'autopilot.plan.get'>>>['plans'];
type Managed = Awaited<ReturnType<typeof core.call<'channels.managed'>>>['channels'];

/**
 * Màn Autopilot hôm nay (052, FR-AP-06/07): trạng thái, kế hoạch từng kênh kèm lý do;
 * chạy ngay / tạm dừng / lập lại kế hoạch; bỏ qua hoặc khôi phục mục; mở video đã tạo.
 */
export function AutopilotPanel({
  onOpenVideo,
  onClose,
  initialTab = 'plans',
}: {
  onOpenVideo: (channel: string, video: string) => void;
  onClose: () => void;
  initialTab?: 'plans' | 'publish';
}) {
  const [status, setStatus] = useState<Status>();
  const [plans, setPlans] = useState<Plans>([]);
  const [channels, setChannels] = useState<Managed>([]);
  const [tab, setTab] = useState(initialTab);
  const [filter, setFilter] = useState('');
  const [settingsFor, setSettingsFor] = useState<string>();
  const [previews, setPreviews] = useState<Record<string, DailyPlan>>({});
  const [job, setJob] = useState<{ id: string; channel?: string }>();
  const [pending, setPending] = useState('');
  const busy = useRef(false);
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string }>();

  const load = async () => {
    try {
      const [s, managed] = await Promise.all([
        core.call('autopilot.status', {}),
        core.call('channels.managed', {}),
      ]);
      setStatus(s);
      setChannels(managed.channels);
      const results = await Promise.all(
        managed.channels
          .filter((c) => c.exists)
          .map((c) => core.call('autopilot.plan.get', { channel: c.path })),
      );
      setPlans(results.flatMap((p) => p.plans));
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    }
  };
  useEffect(() => {
    void load();
    const off = core.on('autopilot.updated', (s) => {
      setStatus(s);
      void load();
    });
    return off;
  }, []);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  // 096: poll the exact durable job; completion events can arrive before enqueue returns.
  useEffect(() => {
    if (!job) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const { job: current } = await core.call('job.get', { job_id: job.id });
        if (stopped) return;
        if (current.status === 'queued' || current.status === 'running') {
          setPending(current.progress.message ?? 'Đang chờ lập kế hoạch…');
          timer = setTimeout(() => void poll(), 1000);
          return;
        }
        if (current.status !== 'succeeded')
          throw new Error(current.error?.message ?? 'Lập kế hoạch đã bị hủy hoặc chưa hoàn tất.');
        const result = current.result as PlanJobResult;
        if (result.paused)
          throw new Error(
            'Autopilot đang tạm dừng nên chưa lập kế hoạch. Bạn vẫn có thể xem thử từng kênh.',
          );
        if (job.channel) {
          // A preview job targets exactly one channel; Windows may canonicalize an 8.3 path.
          const plan = result.plans.length === 1 ? result.plans[0]?.plan : undefined;
          if (!plan) throw new Error('Không nhận được bản xem thử của kênh.');
          setPreviews((all) => ({ ...all, [job.channel!]: plan }));
        } else {
          setPreviews({});
        }
        const count = result.plans.reduce((n, p) => n + p.items, 0);
        const added = result.plans.reduce((n, p) => n + p.added, 0);
        setMsg({
          tone: 'success',
          text: `${job.channel ? 'Đã xem thử' : 'Đã lập kế hoạch'}: ${count} mục${job.channel ? '' : `, bổ sung ${added} mục`}.${count ? '' : ' Chưa có mục phù hợp; xem lý do bên dưới từng kênh.'}`,
        });
        await load();
      } catch (e) {
        if (!stopped) setMsg({ tone: 'error', text: (e as Error).message });
      }
      if (!stopped) {
        setJob(undefined);
        setPending('');
        busy.current = false;
      }
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [job]);

  const startPlan = async (channel?: string) => {
    if (busy.current) return;
    busy.current = true;
    setMsg(undefined);
    setPending(channel ? 'Đang chuẩn bị bản xem thử…' : 'Đang lập lại kế hoạch…');
    try {
      const r = channel
        ? await core.call('autopilot.plan.preview', { channel })
        : await core.call('autopilot.plan.run', {});
      setJob({ id: r.job_id, ...(channel ? { channel } : {}) });
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
      setPending('');
      busy.current = false;
    }
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    if (busy.current) return;
    busy.current = true;
    setPending('Đang cập nhật…');
    setMsg(undefined);
    try {
      await fn();
      setMsg({ tone: 'success', text: ok });
      await load();
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    } finally {
      setPending('');
      busy.current = false;
    }
  };

  return (
    <Surface
      label="Autopilot hôm nay"
      className="autopilot-panel"
      testId="autopilot-panel"
      onClose={onClose}
    >
      <div className="row">
        <h2>Autopilot hôm nay</h2>
        <button onClick={onClose}>Đóng</button>
      </div>
      <p className="muted">
        Xem thử lịch của từng kênh trước khi bật. Bật Autopilot cho phép tự làm video trong khung
        giờ làm việc; duyệt và quản lý đăng ở tab bên cạnh.
      </p>
      <p className="muted">
        Tắt kênh: hoàn tất bước đang chạy rồi dừng. Video đã lên lịch trên nền tảng cần Hủy đăng
        riêng trong tab duyệt đăng.
      </p>
      <div className="row ap-tabs" role="tablist" aria-label="Quản lý Autopilot">
        <button role="tab" aria-selected={tab === 'plans'} onClick={() => setTab('plans')}>
          Kế hoạch & kênh
        </button>
        <button role="tab" aria-selected={tab === 'publish'} onClick={() => setTab('publish')}>
          Duyệt trước khi đăng
        </button>
      </div>
      {pending && (
        <p role="status" className="ap-progress" aria-live="polite">
          {pending}
        </p>
      )}
      {msg && (
        <p className={msg.tone === 'error' ? 'error' : 'success'} role="status">
          {msg.text}
        </p>
      )}
      {tab === 'plans' && (
        <>
          {status && (
            <p className="ap-status" data-testid="autopilot-status" role="status">
              {statusLine(status)}
            </p>
          )}
          <div className="row">
            <button
              className="primary"
              disabled={
                !!pending ||
                !channels.some((c) => c.exists && c.autopilot) ||
                !status ||
                status.paused ||
                status.running
              }
              onClick={() =>
                void act(async () => {
                  const r = await core.call('autopilot.run_now', {});
                  if (!r.started)
                    throw new Error(
                      r.reason === 'limit_wait'
                        ? 'Đang chờ hạn mức Claude.'
                        : r.reason === 'running'
                          ? 'Autopilot đang chạy.'
                          : 'Autopilot đang tạm dừng.',
                    );
                }, 'Đã cho Autopilot chạy ngay.')
              }
            >
              Chạy ngay
            </button>
            {status?.paused ? (
              <button
                disabled={!!pending}
                onClick={() => void act(() => core.call('autopilot.resume', {}), 'Đã tiếp tục.')}
              >
                Tiếp tục
              </button>
            ) : (
              <button
                disabled={!!pending}
                onClick={() => void act(() => core.call('autopilot.pause', {}), 'Đã tạm dừng.')}
              >
                Tạm dừng
              </button>
            )}
            <button
              disabled={
                !!pending ||
                !status ||
                status.paused ||
                status.running ||
                !channels.some((c) => c.exists && c.autopilot)
              }
              onClick={() => void startPlan()}
            >
              Lập lại kế hoạch
            </button>
          </div>
          <p className="muted">
            Lập lại kế hoạch chỉ bổ sung chỗ trống cho các kênh đang bật, giữ mọi mục đã có.{' '}
            {status?.paused
              ? 'Đang tạm dừng: bấm Tiếp tục để lập thật, hoặc xem thử từng kênh bên dưới.'
              : !channels.some((c) => c.exists && c.autopilot)
                ? 'Chưa bật kênh nào: hãy xem thử một kênh bên dưới.'
                : ''}
          </p>
          {channels.map((channel) => {
            const saved = plans.find((p) => p.channel === channel.path);
            const preview = previews[channel.path];
            const p = {
              channel: channel.path,
              name: channel.name,
              date: preview?.date ?? saved?.date ?? '',
              plan: preview ?? saved?.plan,
            };
            return (
              <section key={p.channel} className="ap-channel" data-testid="autopilot-channel">
                <h3>
                  {p.name}{' '}
                  <span className="muted">
                    {p.plan ? itemSummary(p.plan.items) || 'chưa có mục' : 'chưa lập kế hoạch'}
                  </span>
                </h3>
                <div className="row ap-channel-actions">
                  <label>
                    <input
                      type="checkbox"
                      checked={channel.autopilot}
                      disabled={!channel.exists || !!pending}
                      onChange={(e) => {
                        const enabled = e.target.checked;
                        void act(
                          () =>
                            core.call('channel.autopilot.set', {
                              channel: channel.path,
                              key: 'autopilot.enabled',
                              value: enabled,
                            }),
                          `${enabled ? 'Đã bật' : 'Đã tắt'} Autopilot cho ${channel.name}.`,
                        );
                      }}
                    />{' '}
                    Autopilot {channel.autopilot ? 'đang bật' : 'đang tắt'}
                  </label>
                  <button
                    disabled={!channel.exists || !!pending}
                    onClick={() => void startPlan(channel.path)}
                  >
                    Xem thử kế hoạch
                  </button>
                  <button
                    disabled={!channel.exists || !!pending}
                    onClick={() => setSettingsFor(channel.path)}
                  >
                    Cài đặt kênh
                  </button>
                  {preview && (
                    <button
                      onClick={() =>
                        setPreviews((all) => {
                          const next = { ...all };
                          delete next[channel.path];
                          return next;
                        })
                      }
                    >
                      Xem kế hoạch đã lưu
                    </button>
                  )}
                </div>
                {!channel.exists && <p className="error">Không tìm thấy thư mục kênh.</p>}
                {preview && (
                  <p className="ap-preview-note">
                    Bản xem thử · {preview.date} · Chưa lưu vào hàng đợi. Bấm Tạo video ở một mục để
                    bắt đầu làm thủ công. Lịch sẽ được tính lại khi chạy thật.
                  </p>
                )}
                {p.plan && <p className="muted">Ngày kế hoạch: {p.plan.date}</p>}
                {p.plan?.notes?.map((n) => (
                  <p key={n} className="muted">
                    {n}
                  </p>
                ))}
                <ul className="list">
                  {(p.plan?.items ?? [])
                    .filter((it) => it.note !== 'Đã xóa khỏi kế hoạch.')
                    .map((it) => (
                      <li key={it.id} className={`ap-item ${it.status}`}>
                        <div className="row">
                          <span className={`badge st-${it.status}`}>
                            {it.video_id && it.note === 'Đã chuyển sang tạo video thủ công.'
                              ? 'Tạo thủ công'
                              : itemStatusLabel(it.status)}
                          </span>
                          <b>{it.title}</b>
                          <span className="muted">
                            {it.workflow_id}
                            {it.publish_at
                              ? ` · đăng ${new Date(it.publish_at).toLocaleDateString('vi-VN')} ${timeOf(it.publish_at)}`
                              : ' · chưa có giờ đăng'}{' '}
                            · {it.score} điểm
                          </span>
                        </div>
                        <div className="muted">{it.angle}</div>
                        {it.note && (
                          <div className={it.status === 'failed' ? 'error' : 'muted'}>
                            {it.note}
                          </div>
                        )}
                        <div className="row">
                          <button
                            className="link"
                            onClick={() => setOpen(open === it.id ? null : it.id)}
                          >
                            {open === it.id ? 'Ẩn lý do' : 'Vì sao chọn?'}
                          </button>
                          {it.video_id && (
                            <button
                              className="link"
                              onClick={() => onOpenVideo(p.channel, it.video_id!)}
                            >
                              Mở video
                            </button>
                          )}
                          {!it.video_id && ['planned', 'skipped'].includes(it.status) && (
                            <button
                              disabled={!!pending}
                              onClick={() =>
                                void act(async () => {
                                  const result = await core.call('autopilot.plan.create_video', {
                                    channel: p.channel,
                                    date: p.date,
                                    item_id: it.id,
                                    ...(preview ? { preview } : {}),
                                  });
                                  setPreviews((all) => {
                                    const next = { ...all };
                                    delete next[p.channel];
                                    return next;
                                  });
                                  onOpenVideo(p.channel, result.video_id);
                                }, `Đã mở video "${it.title}" để tạo thủ công.`)
                              }
                            >
                              Tạo video
                            </button>
                          )}
                          {!it.video_id && ['planned', 'skipped'].includes(it.status) && (
                            <button
                              className="link"
                              disabled={!!pending}
                              onClick={() =>
                                void act(
                                  async () => {
                                    if (preview) {
                                      setPreviews((all) => ({
                                        ...all,
                                        [p.channel]: {
                                          ...preview,
                                          items: preview.items.filter((item) => item.id !== it.id),
                                        },
                                      }));
                                    } else {
                                      await core.call('autopilot.plan.remove', {
                                        channel: p.channel,
                                        date: p.date,
                                        item_id: it.id,
                                      });
                                    }
                                  },
                                  `Đã xóa "${it.title}" khỏi ${preview ? 'bản xem thử' : 'kế hoạch'}.`,
                                )
                              }
                            >
                              Xóa
                            </button>
                          )}
                          {!preview && it.status === 'skipped' && !it.video_id && (
                            <button
                              className="link"
                              disabled={!!pending}
                              onClick={() =>
                                void act(
                                  () =>
                                    core.call('autopilot.plan.update', {
                                      channel: p.channel,
                                      date: p.date,
                                      item_id: it.id,
                                      patch: { status: 'planned' },
                                    }),
                                  `Đã khôi phục "${it.title}".`,
                                )
                              }
                            >
                              Khôi phục
                            </button>
                          )}
                        </div>
                        {open === it.id && (
                          <ul className="ap-reasons">
                            {it.reasons.map((r) => (
                              <li key={r}>{r}</li>
                            ))}
                            {it.source.url && (
                              <li>
                                Nguồn:{' '}
                                <a href={it.source.url} target="_blank" rel="noreferrer">
                                  {it.source.url}
                                </a>
                              </li>
                            )}
                          </ul>
                        )}
                      </li>
                    ))}
                </ul>
              </section>
            );
          })}
          {!channels.length && (
            <p className="muted">
              Chưa có kênh nào trong danh sách quản lý. Mở mục <b>Kênh</b> trên sidebar để tạo hoặc
              thêm kênh.
            </p>
          )}
        </>
      )}
      {tab === 'publish' && (
        <div className="ap-publish">
          <label>
            Lọc kênh{' '}
            <select value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">Tất cả kênh</option>
              {channels
                .filter((c) => c.exists)
                .map((c) => (
                  <option key={c.path} value={c.path}>
                    {c.name}
                  </option>
                ))}
            </select>
          </label>
          {channels
            .filter((c) => c.exists && (!filter || c.path === filter))
            .map((c) => (
              <section key={c.path} className="ap-channel">
                <h3>
                  {c.name}{' '}
                  <span className="muted">
                    {c.autopilot ? 'Autopilot đang bật' : 'Autopilot đang tắt'}
                  </span>
                </h3>
                <PublishReview
                  channel={c.path}
                  embedded
                  onOpenVideo={(id) => onOpenVideo(c.path, id)}
                  onClose={onClose}
                />
              </section>
            ))}
          {!channels.some((c) => c.exists) && <p className="muted">Chưa có kênh để duyệt đăng.</p>}
        </div>
      )}
      {settingsFor && (
        <AsPage.Provider value={false}>
          <ChannelSettings
            channel={settingsFor}
            onClose={() => {
              setSettingsFor(undefined);
              setPreviews({});
              void load();
            }}
          />
        </AsPage.Provider>
      )}
    </Surface>
  );
}
