import { useEffect, useState } from 'react';
import type { JobInfo, VideoStateSummary } from '@studioflow/core';
import { core } from './rpc';

const ICON: Record<string, string> = {
  pending: '○',
  running: '◐',
  waiting_approval: '⏸',
  done: '●',
  failed: '✕',
  skipped: '–',
  stale: '↻',
};

/** UI-04 Tiến độ: dựng từ workflow.yaml + state.json, không có mã riêng theo workflow (FR-WF-02). */
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
  useEffect(() => {
    void core.call('workflow.list', {}).then((r) => setWorkflows(r.workflows));
  }, []);
  if (!video || !state) return <p className="muted">Chọn một video.</p>;
  const act = async (fn: () => Promise<VideoStateSummary>) => onState(await fn());
  if (state.phase === 'briefing') {
    return (
      <div data-testid="progress">
        <p>Pha briefing — chọn workflow (agent cũng làm việc này qua chat):</p>
        {workflows.map((w) => (
          <button
            key={w.id}
            onClick={() =>
              void act(() =>
                core.call('workflow.select', {
                  channel,
                  video,
                  workflow_id: w.id,
                  output_profile: 'yt-1080p30',
                }),
              )
            }
          >
            {w.title}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div data-testid="progress">
      <p className="muted">Workflow: {state.workflow?.id}</p>
      <ol className="steps">
        {state.steps.map((s) => (
          <li key={s.id} className={`step ${s.status}`}>
            <span title={s.status}>{ICON[s.status] ?? '?'}</span> {s.title}
            {s.refine && (
              <span className="muted">
                {' '}
                · {s.refine.rounds} vòng, điểm {s.refine.final_score?.toFixed(1)}
                {s.refine.incomplete ? ' · chưa đủ vòng' : ''}
              </span>
            )}
            <span className="actions">
              <button
                title="Chạy tới bước này"
                onClick={() =>
                  void act(() => core.call('workflow.run_to', { channel, video, step_id: s.id }))
                }
              >
                ▶
              </button>
              <button
                title="Quay lại bước này"
                onClick={() =>
                  void act(() => core.call('workflow.rewind', { channel, video, step_id: s.id }))
                }
              >
                ↺
              </button>
            </span>
          </li>
        ))}
      </ol>
      <button onClick={() => void act(() => core.call('workflow.pause', { channel, video }))}>
        Tạm dừng
      </button>
    </div>
  );
}

/** UI-06 Job: loại, trạng thái, tiến độ; hủy/thử lại; lọc theo video (sự kiện `job.updated`). */
export function JobsTab({ video }: { video?: string }) {
  const [jobs, setJobs] = useState<JobInfo[]>([]);
  const [all, setAll] = useState(false);
  useEffect(() => {
    void core
      .call('job.list', { ...(video && !all ? { video } : {}), limit: 100 })
      .then((r) => setJobs(r.jobs));
    return core.on('job.updated', (j) => setJobs((s) => [j, ...s.filter((x) => x.id !== j.id)]));
  }, [video, all]);
  return (
    <div>
      <label>
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Mọi video
      </label>
      <table className="jobs" data-testid="jobs">
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id}>
              <td>{j.kind}</td>
              <td>{j.status}</td>
              <td>
                {j.progress.total
                  ? `${Math.round((j.progress.done / j.progress.total) * 100)}%`
                  : ''}
              </td>
              <td>{j.engine ?? ''}</td>
              <td>
                {(j.status === 'queued' || j.status === 'running') && (
                  <button onClick={() => void core.call('job.cancel', { job_id: j.id })}>
                    Hủy
                  </button>
                )}
                {(j.status === 'failed' || j.status === 'canceled') && (
                  <button onClick={() => void core.call('job.retry', { job_id: j.id })}>
                    Thử lại
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** UI-05 Xem trước (M1: render; Studio nhúng ở 017). */
export function PreviewTab({ channel, video }: { channel: string; video?: string }) {
  const [msg, setMsg] = useState('');
  if (!video) return <p className="muted">Chọn một video.</p>;
  const render = async (mode: 'draft' | 'release') => {
    try {
      const r = await core.call('render.start', { channel, video, mode });
      setMsg(
        `Đã xếp render ${mode === 'draft' ? 'nháp' : 'phát hành'} (${r.job_id}) — xem tab Job.`,
      );
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <div>
      <div className="row">
        <button onClick={() => void render('draft')}>Render nháp</button>
        <button onClick={() => void render('release')}>Render phát hành</button>
      </div>
      <p>{msg}</p>
    </div>
  );
}

type Track = {
  id: string;
  title?: string;
  original_name: string;
  tags: string[];
  scope: string;
  analysis: { duration_ms: number; bpm?: number; energy: number };
};

/** UI-07 Nhạc: kho app + kênh, tìm bằng `music.find`, kéo thả/chọn file để nạp. */
export function MusicTab({ channel }: { channel: string }) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [q, setQ] = useState('');
  const [found, setFound] = useState<string[] | null>(null);
  const load = () =>
    void core.call('music.list', { channel }).then((r) => setTracks(r.tracks as Track[]));
  useEffect(load, [channel]);
  const find = async () => {
    try {
      const r = (await core.call('music.find', { channel, query: q })) as {
        results: { track_id: string }[];
      };
      setFound(r.results.map((x) => x.track_id));
    } catch {
      setFound([]);
    }
  };
  const add = async () => {
    const files = await window.studioflow.pickFiles();
    if (files.length)
      await core.call('music.add', { channel, paths_on_disk: files, scope: 'channel' });
  };
  const shown = found ? tracks.filter((t) => found.includes(t.id)) : tracks;
  return (
    <div>
      <div className="row">
        <input
          placeholder="Tìm: nhạc chậm piano…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <button onClick={() => void find()}>Tìm</button>
        <button onClick={() => (setFound(null), load())}>Tất cả</button>
        <button onClick={() => void add()}>Nạp…</button>
      </div>
      <table className="jobs">
        <tbody>
          {shown.map((t) => (
            <tr key={t.id}>
              <td>{t.title ?? t.original_name}</td>
              <td>{Math.round(t.analysis.duration_ms / 1000)} s</td>
              <td>{t.analysis.bpm ? `${Math.round(t.analysis.bpm)} BPM` : ''}</td>
              <td>{t.tags.join(', ')}</td>
              <td className="muted">{t.scope}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type SpanRow = {
  span_id: string;
  trace_id: string;
  name: string;
  start_ms: number;
  end_ms: number;
  status: string;
  depth?: number;
  attrs: Record<string, unknown>;
};

/** UI-08 Trace (M1 đơn giản): lần chạy → cây span, thời gian, token. */
export function TraceTab({ video }: { video?: string }) {
  const [traces, setTraces] = useState<SpanRow[]>([]);
  const [spans, setSpans] = useState<SpanRow[] | null>(null);
  useEffect(() => {
    void core
      .call('trace.list', { ...(video ? { video } : {}), limit: 50 })
      .then((r) => setTraces(r.traces as SpanRow[]));
  }, [video]);
  if (spans) {
    return (
      <div data-testid="trace-spans">
        <button onClick={() => setSpans(null)}>← Danh sách</button>
        <ul className="spans">
          {spans.map((s) => (
            <li key={s.span_id} style={{ paddingLeft: (s.depth ?? 0) * 14 }} className={s.status}>
              {s.name} <span className="muted">{Math.round(s.end_ms - s.start_ms)} ms</span>
              {s.attrs['gen_ai.usage.input_tokens'] !== undefined && (
                <span className="muted">
                  {' '}
                  · {String(s.attrs['gen_ai.usage.input_tokens'])}/
                  {String(s.attrs['gen_ai.usage.output_tokens'])} token
                </span>
              )}
              {typeof s.attrs['sf.tool_name'] === 'string' && (
                <span className="muted"> · {s.attrs['sf.tool_name']}</span>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <ul className="list" data-testid="traces">
      {traces.map((t) => (
        <li key={t.span_id}>
          <button
            className="link"
            onClick={() =>
              void core
                .call('trace.get', { trace_id: t.trace_id })
                .then((r) => setSpans(r.spans as SpanRow[]))
            }
          >
            {t.name} · {new Date(t.start_ms).toLocaleTimeString('vi-VN')} ·{' '}
            {Math.round(t.end_ms - t.start_ms)} ms
          </button>
        </li>
      ))}
      {!traces.length && <li className="muted">Chưa có trace.</li>}
    </ul>
  );
}
