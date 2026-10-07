import { useEffect, useState } from 'react';
import { core } from './rpc';
import { itemStatusLabel, itemSummary, statusLine } from './autopilot-view';
import { timeOf } from './session-format';

type Status = Awaited<ReturnType<typeof core.call<'autopilot.status'>>>;
type Plans = Awaited<ReturnType<typeof core.call<'autopilot.plan.get'>>>['plans'];
type Capacity = Awaited<ReturnType<typeof core.call<'autopilot.capacity'>>>;

/**
 * Màn Autopilot hôm nay (052, FR-AP-06/07): trạng thái, năng lực, kế hoạch từng kênh kèm lý do;
 * chạy ngay / tạm dừng / lập lại kế hoạch; bỏ qua hoặc khôi phục mục; mở video đã tạo.
 */
export function AutopilotPanel({
  onOpenVideo,
  onClose,
}: {
  onOpenVideo: (channel: string, video: string) => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<Status>();
  const [plans, setPlans] = useState<Plans>([]);
  const [capacity, setCapacity] = useState<Capacity>();
  const [open, setOpen] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string }>();

  const load = async () => {
    try {
      const [s, p] = await Promise.all([
        core.call('autopilot.status', {}),
        core.call('autopilot.plan.get', {}),
      ]);
      setStatus(s);
      setPlans(p.plans);
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    }
    void core
      .call('autopilot.capacity', {})
      .then(setCapacity)
      .catch(() => {});
  };
  useEffect(() => {
    void load();
    const off = core.on('autopilot.updated', (s) => {
      setStatus(s);
      void core.call('autopilot.plan.get', {}).then((p) => setPlans(p.plans));
    });
    return off;
  }, []);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setMsg({ tone: 'success', text: ok });
      await load();
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    }
  };

  return (
    <div className="modal" onClick={onClose}>
      <div
        className="card autopilot-panel"
        role="dialog"
        aria-label="Autopilot hôm nay"
        data-testid="autopilot-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row">
          <h2>Autopilot hôm nay</h2>
          <button onClick={onClose}>Đóng</button>
        </div>
        {status && (
          <p className="ap-status" data-testid="autopilot-status" role="status">
            {statusLine(status)}
          </p>
        )}
        <div className="row">
          <button
            className="primary"
            disabled={!status || status.paused || status.running}
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
              onClick={() => void act(() => core.call('autopilot.resume', {}), 'Đã tiếp tục.')}
            >
              Tiếp tục
            </button>
          ) : (
            <button
              onClick={() => void act(() => core.call('autopilot.pause', {}), 'Đã tạm dừng.')}
            >
              Tạm dừng
            </button>
          )}
          <button
            onClick={() =>
              void act(
                () => core.call('autopilot.plan.run', {}),
                'Đang lập lại kế hoạch hôm nay (giữ các mục đã làm/đã sửa).',
              )
            }
          >
            Lập lại kế hoạch
          </button>
        </div>
        {capacity && (
          <details className="ap-capacity">
            <summary>
              Năng lực hôm nay: {capacity.videos} video (giới hạn bởi{' '}
              {{
                time: 'thời gian máy',
                tokens: 'ngân sách Claude',
                uploads: 'hạn mức đăng',
                cap: 'trần mỗi ngày',
              }[capacity.limiting_factor] ?? capacity.limiting_factor}
              )
            </summary>
            <ul>
              {capacity.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </details>
        )}
        {plans.map((p) => (
          <section key={p.channel} className="ap-channel" data-testid="autopilot-channel">
            <h3>
              {p.name}{' '}
              <span className="muted">
                {p.plan ? itemSummary(p.plan.items) || 'chưa có mục' : 'chưa lập kế hoạch'}
              </span>
            </h3>
            {p.plan?.notes?.map((n) => (
              <p key={n} className="muted">
                {n}
              </p>
            ))}
            <ul className="list">
              {(p.plan?.items ?? []).map((it) => (
                <li key={it.id} className={`ap-item ${it.status}`}>
                  <div className="row">
                    <span className={`badge st-${it.status}`}>{itemStatusLabel(it.status)}</span>
                    <b>{it.title}</b>
                    <span className="muted">
                      {it.workflow_id}
                      {it.publish_at ? ` · đăng ${timeOf(it.publish_at)}` : ''} · {it.score} điểm
                    </span>
                  </div>
                  <div className="muted">{it.angle}</div>
                  {it.note && (
                    <div className={it.status === 'failed' ? 'error' : 'muted'}>{it.note}</div>
                  )}
                  <div className="row">
                    <button className="link" onClick={() => setOpen(open === it.id ? null : it.id)}>
                      {open === it.id ? 'Ẩn lý do' : 'Vì sao chọn?'}
                    </button>
                    {it.video_id && (
                      <button className="link" onClick={() => onOpenVideo(p.channel, it.video_id!)}>
                        Mở video
                      </button>
                    )}
                    {it.status === 'planned' && (
                      <button
                        className="link"
                        onClick={() =>
                          void act(
                            () =>
                              core.call('autopilot.plan.update', {
                                channel: p.channel,
                                date: p.date,
                                item_id: it.id,
                                patch: { status: 'skipped' },
                              }),
                            `Đã bỏ qua "${it.title}".`,
                          )
                        }
                      >
                        Bỏ qua
                      </button>
                    )}
                    {it.status === 'skipped' && (
                      <button
                        className="link"
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
        ))}
        {!plans.length && (
          <p className="muted">
            Chưa có kênh nào bật Autopilot. Mở <b>Cài đặt kênh</b> để bật và thêm kênh đối thủ.
          </p>
        )}
        {msg && (
          <p className={msg.tone === 'error' ? 'error' : 'success'} role="status">
            {msg.text}
          </p>
        )}
      </div>
    </div>
  );
}
