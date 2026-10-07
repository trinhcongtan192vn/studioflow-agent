import { useEffect, useRef, useState } from 'react';
import type { JobInfo, VideoStateSummary } from '@studioflow/core';
import { activityLabel, friendlyStepError, toolLabel } from './chat-format';
import {
  feedbackFor,
  overall,
  STATUS_LABEL,
  stepButtons,
  stepProgressView,
  type Action,
  type Feedback,
  type StepButton,
} from './progress-format';
import { core } from './rpc';

const ICON: Record<string, string> = {
  pending: '○',
  running: '◐',
  waiting_approval: '⏸',
  done: '✓',
  failed: '✕',
  skipped: '–',
  stale: '↻',
};

/** Lỗi IPC → câu ngắn (bỏ tiền tố kỹ thuật). */
const errText = (e: unknown) =>
  String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+': /, '');

/**
 * UI-04 Tiến độ (FR-WF-02): dựng từ workflow + state.json. Trạng thái tổng + nút điều khiển ở đầu;
 * mỗi thao tác có phản hồi theo dõi kết quả thật (chạy → xong / chờ duyệt / lỗi).
 */
export function ProgressTab({
  channel,
  video,
  state,
  onState,
}: {
  channel: string;
  video?: string;
  state?: VideoStateSummary;
  onState: (s: VideoStateSummary) => void;
}) {
  const [workflows, setWorkflows] = useState<{ id: string; title: string }[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [job, setJob] = useState<JobInfo>();
  // 008 UI-04: tiến độ từng bước (engine), thời điểm bắt đầu, việc agent đang làm, đồng hồ
  const [stepProg, setStepProg] = useState<
    Record<string, { done: number; total: number; message?: string }>
  >({});
  const [startedAt, setStartedAt] = useState<Record<string, string>>({});
  const [activity, setActivity] = useState<string>();
  const [now, setNow] = useState(Date.now());
  const [action, setAction] = useState<Action>();
  const [fb, setFb] = useState<Feedback>();
  const [busy, setBusy] = useState<string>();
  const [confirm, setConfirm] = useState<StepButton>();
  const clearTimer = useRef<ReturnType<typeof setTimeout>>();
  // 034: "Tự duyệt bước" (agent tự quyết, chỉ dừng ở điểm chốt; tên mới từ 047)
  const [autopilot, setAutopilot] = useState<boolean>();
  useEffect(() => {
    if (!video) return;
    void core
      .call('config.resolve', { channel, video, key: 'workflow.autopilot' })
      .then((r) => setAutopilot(r.value === true))
      .catch(() => setAutopilot(undefined));
  }, [channel, video, state?.phase]);
  const toggleAutopilot = async () => {
    if (!video || autopilot === undefined) return;
    try {
      const r = await core.call('workflow.set_autopilot', { channel, video, on: !autopilot });
      setAutopilot(r.on);
      setAction(undefined);
      setFb({
        tone: 'success',
        text: r.on
          ? 'Đã bật Tự duyệt bước: agent tự quyết, chỉ dừng ở brief, truyện/kịch bản, chọn giọng (khi thiếu) và duyệt bản nháp trước render.'
          : 'Đã tắt Tự duyệt bước: mọi điểm duyệt của workflow đều chờ bạn.',
        settled: true,
      });
    } catch (e) {
      setFb({ tone: 'error', text: `Không đổi được chế độ: ${errText(e)}`, settled: true });
    }
  };

  useEffect(() => {
    void core.call('workflow.list', {}).then((r) => setWorkflows(r.workflows));
  }, []);
  useEffect(() => {
    setAction(undefined);
    setFb(undefined);
    setJob(undefined);
    setConfirm(undefined);
  }, [video]);

  // lỗi từng bước (state.json) — tóm tắt trạng thái không mang nội dung lỗi
  const failedKey = state?.steps
    .filter((s) => s.status === 'failed' || s.status === 'running')
    .map((s) => `${s.id}:${s.status}`)
    .join(',');
  useEffect(() => {
    if (!video || !failedKey) {
      setStartedAt({});
      return setErrors({});
    }
    void core
      .call('explorer.read', { channel, path: `videos/${video}/state.json` })
      .then((r) => {
        const st = JSON.parse(r.content ?? 'null') as {
          steps?: Record<
            string,
            { status: string; started_at?: string; error?: { message: string } }
          >;
        } | null;
        setStartedAt(
          Object.fromEntries(
            Object.entries(st?.steps ?? {})
              .filter(([, s]) => s.status === 'running' && s.started_at)
              .map(([id, s]) => [id, s.started_at!]),
          ),
        );
        setErrors(
          Object.fromEntries(
            Object.entries(st?.steps ?? {})
              .filter(([, s]) => s.error)
              .map(([id, s]) => [id, s.error!.message]),
          ),
        );
      })
      .catch(() => setErrors({}));
  }, [channel, video, failedKey]);

  // job đang chạy của video (tiến độ dưới bước đang chạy)
  useEffect(() => {
    if (!video) return;
    return core.on('job.updated', (j) => {
      if (j.video_id !== video) return;
      setJob((cur) => (j.status === 'running' ? j : cur?.id === j.id ? undefined : cur));
    });
  }, [video]);

  useEffect(() => {
    setStepProg({});
    setActivity(undefined);
    if (!video) return;
    void core
      .call('workflow.progress', { channel, video })
      .then((r) => setStepProg(r.steps))
      .catch(() => {});
    const offs = [
      core.on('workflow.progress', (p) => {
        if (p.channel !== channel || p.video !== video) return;
        setStepProg((cur) => {
          const next = { ...cur };
          if (p.done === null || p.total === null) delete next[p.step_id];
          else
            next[p.step_id] = {
              done: p.done,
              total: p.total,
              ...(p.message ? { message: p.message } : {}),
            };
          return next;
        });
      }),
      core.on('chat.event', (e) => {
        if (e.channel !== channel || (e.video ?? undefined) !== video) return;
        if (e.type === 'tool_call')
          setActivity(activityLabel({ kind: 'tool', name: e.name, input: e.input }));
        else if (e.type === 'text_delta') setActivity(activityLabel({ kind: 'writing' }));
        else if (e.type === 'done' || e.type === 'error') setActivity(undefined);
      }),
    ];
    return () => offs.forEach((o) => o());
  }, [channel, video]);
  const anyRunning = state?.steps.some((s) => s.status === 'running');
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anyRunning]);

  // theo dõi kết quả thao tác qua mỗi lần trạng thái đổi; "chạy lại" bước đang lỗi: bỏ qua lỗi cũ
  // tới khi bước rời trạng thái lỗi (037)
  const leftFailed = useRef(false);
  useEffect(() => {
    if (!action || !state || fb?.settled) return;
    if (action.kind === 'run_step' && !leftFailed.current) {
      const t = state.steps.find((x) => x.id === action.step);
      if (t?.status === 'failed') return;
      leftFailed.current = true;
    }
    setFb(feedbackFor(action, state.steps, (id) => errors[id] && friendlyStepError(errors[id]!)));
  }, [state, errors, action, fb?.settled]);
  // thông báo thành công tự ẩn
  useEffect(() => {
    clearTimeout(clearTimer.current);
    if (fb?.settled && fb.tone === 'success')
      clearTimer.current = setTimeout(() => setFb(undefined), 8000);
    return () => clearTimeout(clearTimer.current);
  }, [fb]);

  if (!video || !state) return <p className="muted">Chọn một video.</p>;

  const run = async (a: Action | { kind: 'select'; workflow: string }, key: string) => {
    setBusy(key);
    setConfirm(undefined);
    try {
      let s: VideoStateSummary;
      if (a.kind === 'select')
        s = await core.call('workflow.select', {
          channel,
          video,
          workflow_id: a.workflow,
          output_profile: 'yt-1080p30',
        });
      else if (a.kind === 'pause') s = await core.call('workflow.pause', { channel, video });
      else if (a.kind === 'rewind')
        s = await core.call('workflow.rewind', { channel, video, step_id: a.step });
      else if (a.kind === 'recheck' || a.kind === 'waive') {
        const r =
          a.kind === 'waive'
            ? await core.call('workflow.waive', { channel, video, step_id: a.step, check: a.check })
            : await core.call('workflow.recheck', { channel, video, step_id: a.step });
        onState(r.state);
        if (!r.pass) {
          setAction(undefined);
          setFb({
            tone: 'error',
            text: `Kiểm tra lại chưa đạt: ${r.results
              .filter((x) => !x.pass)
              .map((x) => friendlyStepError(`${x.target}: ${x.detail ?? 'không đạt'}`))
              .join('; ')}`,
            settled: true,
          });
          return;
        }
        s = r.state;
      } else
        s = await core.call(a.kind === 'run_step' ? 'workflow.run_step' : 'workflow.run_to', {
          channel,
          video,
          step_id: a.step,
        });
      onState(s);
      if (a.kind === 'select') {
        setAction(undefined);
        setFb({ tone: 'success', text: 'Đã chọn workflow.', settled: true });
      } else {
        setAction(a);
        leftFailed.current = false;
        setFb(
          a.kind === 'run_step' && s.steps.find((x) => x.id === a.step)?.status === 'failed'
            ? {
                tone: 'progress',
                text: `Đã gửi lệnh chạy lại bước "${s.steps.find((x) => x.id === a.step)!.title}", đang bắt đầu…`,
                settled: false,
              }
            : feedbackFor(a, s.steps),
        );
      }
    } catch (e) {
      setAction(undefined);
      setFb({ tone: 'error', text: `Không thực hiện được: ${errText(e)}`, settled: true });
    } finally {
      setBusy(undefined);
    }
  };

  const banner = fb && (
    <div
      className={`progress-fb ${fb.tone}`}
      role="status"
      aria-live="polite"
      data-testid="progress-feedback"
    >
      <span className="fb-icon">
        {fb.tone === 'progress' ? (
          <span className="spinner" />
        ) : fb.tone === 'error' ? (
          '✕'
        ) : fb.tone === 'success' ? (
          '✓'
        ) : (
          'ℹ'
        )}
      </span>
      <span className="fb-text">{fb.text}</span>
      <button
        className="link fb-close"
        title="Ẩn"
        onClick={() => (setFb(undefined), setAction(undefined))}
      >
        ×
      </button>
    </div>
  );

  if (state.phase === 'briefing') {
    return (
      <div data-testid="progress" className="progress">
        <p>Pha briefing: chọn workflow (agent cũng làm việc này qua chat).</p>
        {banner}
        <div className="wf-choices">
          {workflows.map((w) => (
            <button
              key={w.id}
              disabled={busy !== undefined}
              onClick={() => void run({ kind: 'select', workflow: w.id }, `select:${w.id}`)}
            >
              {busy === `select:${w.id}` ? 'Đang chọn…' : w.title}
            </button>
          ))}
        </div>
      </div>
    );
  }

  const ov = overall(state.steps);
  const wfTitle = workflows.find((w) => w.id === state.workflow?.id)?.title ?? state.workflow?.id;
  const last = state.steps.at(-1);
  /** Thanh tiến trình của bước đang chạy: tiến độ engine → job → việc agent đang làm. */
  const viewOf = (id: string) =>
    stepProgressView({
      progress:
        stepProg[id] ??
        (job
          ? {
              done: job.progress.done,
              total: job.progress.total,
              message: toolLabel(job.kind.replace(/\./g, '_')),
            }
          : undefined),
      ...(activity ? { activity } : {}),
      ...(startedAt[id] ? { startedAt: startedAt[id] } : {}),
      now,
    });
  const runView = ov.state.kind === 'running' ? viewOf(ov.state.step.id) : undefined;
  const head =
    ov.state.kind === 'running'
      ? `Đang chạy: ${ov.state.step.title}`
      : ov.state.kind === 'waiting'
        ? `Chờ bạn duyệt: ${ov.state.step.title}`
        : ov.state.kind === 'failed'
          ? `Lỗi ở bước: ${ov.state.step.title}`
          : ov.state.kind === 'done'
            ? 'Đã xong mọi bước'
            : `Sẵn sàng: ${ov.state.next?.title ?? ''}`;

  return (
    <div data-testid="progress" className="progress">
      <div className="progress-head">
        <div className="progress-title">
          <b>{wfTitle}</b>
          <span className="muted">
            {ov.done}/{ov.total} bước
          </span>
        </div>
        {autopilot !== undefined && (
          <label
            className="autopilot"
            data-testid="autopilot"
            title="Tự duyệt bước: agent tự quyết các bước, chỉ dừng ở điểm chốt"
          >
            <input type="checkbox" checked={autopilot} onChange={() => void toggleAutopilot()} />
            {autopilot ? 'Tự duyệt bước (chỉ dừng ở điểm chốt)' : 'Duyệt từng bước'}
          </label>
        )}
        <div className="progress-bar" aria-hidden="true">
          <div style={{ width: `${(ov.done / Math.max(1, ov.total)) * 100}%` }} />
        </div>
        <div className={`progress-now ${ov.state.kind}`} data-testid="progress-now">
          <span className="now-text">
            {ov.state.kind === 'running' && <span className="spinner" />} {head}
            {runView && <span className="muted"> · {runView.text}</span>}
          </span>
          {ov.state.kind === 'running' ? (
            <button
              disabled={busy !== undefined}
              onClick={() => void run({ kind: 'pause' }, 'pause')}
              title="Dừng sau khi bước đang chạy xong"
            >
              {busy === 'pause' ? 'Đang dừng…' : '⏸ Tạm dừng'}
            </button>
          ) : ov.state.kind === 'idle' && last ? (
            <button
              className="primary"
              disabled={busy !== undefined}
              onClick={() => void run({ kind: 'run_to', step: last.id }, 'resume')}
              title="Chạy tiếp các bước còn lại"
            >
              {busy === 'resume' ? 'Đang gửi…' : '▶ Chạy tiếp'}
            </button>
          ) : null}
        </div>
      </div>
      {banner}
      {confirm && (
        <div className="progress-fb confirm" role="alertdialog" data-testid="progress-confirm">
          <span className="fb-text">{confirm.confirm}</span>
          <button
            className="primary"
            onClick={() =>
              void run(
                confirm.action,
                `${confirm.action.kind}:${'step' in confirm.action ? confirm.action.step : ''}`,
              )
            }
          >
            Xác nhận
          </button>
          <button className="link" onClick={() => setConfirm(undefined)}>
            Hủy
          </button>
        </div>
      )}
      <ol className="steps">
        {state.steps.map((s) => {
          const buttons = stepButtons(s, state.steps, errors[s.id]);
          const err = s.status === 'failed' && errors[s.id];
          return (
            <li key={s.id} className={`step ${s.status}`} data-testid={`step-${s.id}`}>
              <span className={`step-icon ${s.status}`} title={STATUS_LABEL[s.status]}>
                {s.status === 'running' ? <span className="spinner" /> : (ICON[s.status] ?? '?')}
              </span>
              <div className="step-main">
                <div className="step-title">{s.title}</div>
                <div className="step-sub">
                  <span className={`step-status ${s.status}`}>
                    {STATUS_LABEL[s.status] ?? s.status}
                  </span>
                  {s.refine && (
                    <span className="muted">
                      {' '}
                      · {s.refine.rounds} vòng, điểm {s.refine.final_score?.toFixed(1)}
                      {s.refine.incomplete ? ' · chưa đủ vòng' : ''}
                    </span>
                  )}
                </div>
                {s.status === 'running' &&
                  (() => {
                    const v = viewOf(s.id);
                    return (
                      <div className="step-progress" data-testid={`step-progress-${s.id}`}>
                        <div
                          className={`sp-bar${v.pct === null ? ' indeterminate' : ''}`}
                          role="progressbar"
                          aria-label={`Tiến độ ${s.title}`}
                          {...(v.pct !== null
                            ? { 'aria-valuenow': v.pct, 'aria-valuemin': 0, 'aria-valuemax': 100 }
                            : {})}
                        >
                          <div style={v.pct !== null ? { width: `${v.pct}%` } : undefined} />
                        </div>
                        <div className="sp-meta">
                          <span className="sp-text">{v.text}</span>
                          <span className="muted sp-time">
                            {v.pct !== null ? `${v.pct}%` : ''}
                            {v.elapsed ? `${v.pct !== null ? ' · ' : ''}${v.elapsed}` : ''}
                          </span>
                        </div>
                      </div>
                    );
                  })()}
                {err && (
                  <div className="step-error" title={err}>
                    {friendlyStepError(err)}
                  </div>
                )}
              </div>
              <span className="step-actions">
                {buttons.map((b) => {
                  const key = `${b.action.kind}:${'step' in b.action ? b.action.step : ''}`;
                  return (
                    <button
                      key={b.label}
                      className={b.primary ? 'primary' : ''}
                      title={b.title}
                      disabled={busy !== undefined}
                      onClick={() => (b.confirm ? setConfirm(b) : void run(b.action, key))}
                    >
                      {busy === key ? 'Đang gửi…' : b.label}
                    </button>
                  );
                })}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
