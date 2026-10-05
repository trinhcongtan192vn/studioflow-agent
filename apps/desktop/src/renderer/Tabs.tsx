import { useEffect, useRef, useState } from 'react';
import type { JobInfo } from '@studioflow/core';
import { core } from './rpc';
import { CaptionPanel } from './CaptionPanel';
import { addContextRef } from './context-refs';
import { StudioBridge } from './studio-bridge';

export { ProgressTab } from './ProgressTab';

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
  const [url, setUrl] = useState<string>();
  const [wide, setWide] = useState(false);
  const [editing, setEditing] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const bridge = useRef<StudioBridge>();
  useEffect(() => {
    setUrl(undefined);
  }, [video]);
  useEffect(() => {
    bridge.current?.dispose();
    bridge.current = url && frameRef.current ? new StudioBridge(frameRef.current) : undefined;
    return () => bridge.current?.dispose();
  }, [url, wide]);
  if (!video) return <p className="muted">Chọn một video.</p>;
  // FR-CH-04 (028): đính kèm mốc đầu phát / phần tử đang chọn trong Studio làm ngữ cảnh chat
  const attachTime = async () => {
    try {
      addContextRef({ kind: 'time', time_ms: await bridge.current!.currentTimeMs() });
      setMsg('Đã đính kèm mốc hiện tại vào chat.');
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const attachSelection = async () => {
    try {
      addContextRef(await bridge.current!.selection());
      setMsg('Đã đính kèm phần tử đang chọn vào chat.');
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
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
  // UI-05 / D9 mục 2–3: Studio xem trước (chỉ đọc) hoặc chế độ chỉnh (025) nhúng trong panel
  const openStudio = async (mode: 'preview' | 'edit') => {
    try {
      setUrl((await core.call('studio.open', { channel, video, mode })).url);
      setEditing(mode === 'edit');
      setMsg(mode === 'edit' ? 'Đang chỉnh trong Studio — agent tạm không ghi file cảnh.' : '');
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const commit = async () => {
    try {
      const r = await core.call('studio.commit', { channel, video });
      setMsg(
        r.changed_files.length
          ? `Đã lưu ${r.changed_files.length} file; frame chỉnh tay: ${r.pinned_frames.join(', ') || '—'}.`
          : 'Không có thay đổi để lưu.',
      );
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const closeStudio = async () => {
    try {
      await core.call('studio.close', { channel, video });
    } catch (e) {
      // D9 3.5: còn thay đổi chưa lưu → hỏi người dùng
      if (!/E_STUDIO_UNCOMMITTED|uncommitted/.test((e as Error).message)) {
        setMsg((e as Error).message);
        return;
      }
      if (!window.confirm('Còn thay đổi chưa lưu trong Studio. Bỏ các thay đổi đó?')) return;
      await core.call('studio.close', { channel, video, discard: true });
    }
    setUrl(undefined);
    setEditing(false);
  };
  const studio = url && (
    <iframe
      ref={frameRef}
      // WebMCP của Studio cần quyền `tools` qua chuỗi iframe (028)
      allow="tools; clipboard-read; clipboard-write; fullscreen"
      data-testid="studio"
      title="Studio"
      src={url}
      className={wide ? 'studio wide' : 'studio'}
    />
  );
  return (
    <div className="preview">
      <div className="row">
        {url ? (
          <>
            <button onClick={() => setWide(!wide)}>{wide ? 'Thu nhỏ' : 'Mở rộng'}</button>
            <button onClick={() => void attachTime()}>Đính kèm mốc hiện tại</button>
            <button onClick={() => void attachSelection()}>Đính kèm phần tử đang chọn</button>
            {editing && <button onClick={() => void commit()}>Lưu thay đổi Studio</button>}
            <button onClick={() => void closeStudio()}>Đóng Studio</button>
          </>
        ) : (
          <>
            <button onClick={() => void openStudio('preview')}>Mở Studio xem trước</button>
            <button onClick={() => void openStudio('edit')}>Chỉnh trong Studio</button>
          </>
        )}
        <button onClick={() => void render('draft')}>Render nháp</button>
        <button onClick={() => void render('release')}>Render phát hành</button>
      </div>
      <p>{msg}</p>
      {wide ? (
        <div className="modal" onClick={() => setWide(false)}>
          {studio}
        </div>
      ) : (
        studio
      )}
      {/* UI-11 bảng caption dưới khung xem trước (D9 mục 6, 026) */}
      <CaptionPanel key={video} channel={channel} video={video} />
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
  // FR-OB-04 (028): bật Phoenix → nút mở trace chi tiết
  const [phoenix, setPhoenix] = useState(false);
  useEffect(() => {
    void core
      .call('settings.get', {})
      .then((s) =>
        setPhoenix(
          Boolean((s as { trace?: { phoenix_enabled?: boolean } }).trace?.phoenix_enabled),
        ),
      );
  }, []);
  useEffect(() => {
    void core
      .call('trace.list', { ...(video ? { video } : {}), limit: 50 })
      .then((r) => setTraces(r.traces as SpanRow[]));
  }, [video]);
  if (spans) {
    return (
      <div data-testid="trace-spans">
        <button onClick={() => setSpans(null)}>← Danh sách</button>
        {phoenix && (
          <a href={PHOENIX} target="_blank" rel="noreferrer">
            Mở trong Phoenix
          </a>
        )}
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

type CostTotals = {
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  gpu_s: number;
  images: number;
};
const KIND: Record<string, string> = { llm: 'LLM', image_api: 'API ảnh', gpu: 'GPU' };

const PHOENIX = 'http://127.0.0.1:6006';

/** UI-12 Báo cáo chi phí (D11 mục 3, FR-OB-03, 028): video → bước → loại; so ngân sách; xuất CSV. */
export function CostTab({ channel, video }: { channel: string; video?: string }) {
  const [r, setR] = useState<{
    total: CostTotals;
    steps: { step_id: string | null; total: CostTotals; kinds: Record<string, CostTotals> }[];
    budget: {
      tokens_used: number;
      api_cost_usd: number;
      limit_tokens: number | null;
      limit_api_cost_usd: number | null;
    };
    estimated: boolean;
    csv: string;
  }>();
  const [msg, setMsg] = useState('');
  useEffect(() => {
    setR(undefined);
    if (!video) return;
    void core
      .call('cost.report', { channel, video })
      .then((x) => setR(x as never))
      .catch((e: Error) => setMsg(e.message));
  }, [channel, video]);
  if (!video) return <p className="muted">Chọn một video.</p>;
  if (!r) return <p className="muted">{msg || 'Đang tải…'}</p>;
  const usd = (x: number) => `$${x.toFixed(4)}`;
  const download = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([r.csv], { type: 'text/csv' }));
    a.download = `chi-phi-${video}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const row = (label: string, t: CostTotals, key: string, strong = false) => (
    <tr key={key} className={strong ? 'strong' : undefined}>
      <td>{label}</td>
      <td>{t.input_tokens.toLocaleString('vi-VN')}</td>
      <td>{t.output_tokens.toLocaleString('vi-VN')}</td>
      <td>{usd(t.cost_usd)}</td>
      <td>{t.gpu_s ? `${t.gpu_s.toFixed(1)} s` : ''}</td>
      <td>{t.images || ''}</td>
    </tr>
  );
  return (
    <div data-testid="cost">
      <div className="row">
        <span>
          Ngân sách: {r.budget.tokens_used.toLocaleString('vi-VN')}
          {r.budget.limit_tokens ? ` / ${r.budget.limit_tokens.toLocaleString('vi-VN')}` : ''} token
          · {usd(r.budget.api_cost_usd)}
          {r.budget.limit_api_cost_usd ? ` / ${usd(r.budget.limit_api_cost_usd)}` : ''}
        </span>
        <button onClick={download}>Xuất CSV</button>
      </div>
      <table className="cost">
        <thead>
          <tr>
            <th>Bước / loại</th>
            <th>Token vào</th>
            <th>Token ra</th>
            <th>Chi phí</th>
            <th>GPU</th>
            <th>Ảnh API</th>
          </tr>
        </thead>
        <tbody>
          {r.steps.flatMap((s) => [
            row(s.step_id ?? '(chat)', s.total, `${s.step_id}`, true),
            ...Object.entries(s.kinds).map(([k, t]) =>
              row(`  ${KIND[k] ?? k}`, t, `${s.step_id}:${k}`),
            ),
          ])}
          {row('Tổng', r.total, 'total', true)}
        </tbody>
      </table>
      {r.estimated && (
        <p className="muted">Chi phí API ảnh là ước tính theo bảng giá trong cài đặt.</p>
      )}
    </div>
  );
}
