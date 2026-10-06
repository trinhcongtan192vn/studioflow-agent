import { useEffect, useRef, useState } from 'react';
import type { JobInfo, VideoStateSummary } from '@studioflow/core';
import { friendlyStepError, toolLabel } from './chat-format';
import {
  feedbackFor,
  overall,
  STATUS_LABEL,
  stepButtons,
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
  const [action, setAction] = useState<Action>();
  const [fb, setFb] = useState<Feedback>();
  const [busy, setBusy] = useState<string>();
  const [confirm, setConfirm] = useState<StepButton>();
  const clearTimer = useRef<ReturnType<typeof setTimeout>>();
  // 034: chế độ tự động (agent tự quyết, chỉ dừng ở điểm chốt)
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
          ? 'Đã bật chế độ tự động: agent tự quyết, chỉ dừng ở brief, truyện/kịch bản, chọn giọng (khi thiếu) và duyệt bản nháp trước render.'
          : 'Đã tắt chế độ tự động: mọi điểm duyệt của workflow đều chờ bạn.',
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
    .filter((s) => s.status === 'failed')
    .map((s) => s.id)
    .join(',');
  useEffect(() => {
    if (!video || !failedKey) return setErrors({});
    void core
      .call('explorer.read', { channel, path: `videos/${video}/state.json` })
      .then((r) => {
        const st = JSON.parse(r.content ?? 'null') as {
          steps?: Record<string, { error?: { message: string } }>;
        } | null;
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

  // theo dõi kết quả thao tác qua mỗi lần trạng thái đổi
  useEffect(() => {
    if (!action || !state || fb?.settled) return;
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
      else
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
        setFb(feedbackFor(a, s.steps));
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
  const jobText =
    job &&
    `${toolLabel(job.kind.replace(/\./g, '_'))}${job.progress.total ? ` ${job.progress.done}/${job.progress.total}` : ''}${job.progress.message ? ` · ${job.progress.message}` : ''}`;
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
            title="Tự động: agent tự quyết các bước, chỉ dừng ở điểm chốt"
          >
            <input type="checkbox" checked={autopilot} onChange={() => void toggleAutopilot()} />
            {autopilot ? 'Tự động (chỉ dừng ở điểm chốt)' : 'Duyệt từng bước'}
          </label>
        )}
        <div className="progress-bar" aria-hidden="true">
          <div style={{ width: `${(ov.done / Math.max(1, ov.total)) * 100}%` }} />
        </div>
        <div className={`progress-now ${ov.state.kind}`} data-testid="progress-now">
          <span className="now-text">
            {ov.state.kind === 'running' && <span className="spinner" />} {head}
            {ov.state.kind === 'running' && jobText && <span className="muted"> · {jobText}</span>}
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
          const buttons = stepButtons(s, state.steps);
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
                  {s.status === 'running' && jobText && <span className="muted"> · {jobText}</span>}
                </div>
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
