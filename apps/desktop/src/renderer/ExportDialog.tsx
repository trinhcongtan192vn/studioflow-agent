import { useEffect, useState } from 'react';
import { core } from './rpc';

type Render = Awaited<ReturnType<typeof core.call<'render.list'>>>['renders'][number];
type Include = { thumbnail: boolean; captions: boolean; description: boolean };
type Result = Awaited<ReturnType<typeof core.call<'video.export'>>>;

// nhớ theo máy: thư mục xuất lần trước, các mục kèm theo
const DIR_KEY = 'sf.export.dir';
const INC_KEY = 'sf.export.include';
const load = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
};
const save = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* không lưu được → lần sau hỏi lại */
  }
};

const EXTRAS: { id: keyof Include; label: string }[] = [
  { id: 'thumbnail', label: 'Hình đại diện (.jpg)' },
  { id: 'captions', label: 'Phụ đề (.srt)' },
  { id: 'description', label: 'Tiêu đề, mô tả, chương, thẻ (.txt)' },
];
const SKIPPED: Record<string, string> = {
  thumbnail: 'chưa có hình đại diện',
  captions: 'chưa có phụ đề',
  description: 'chưa có publish.md',
};

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** 066: lưu bản render (+ file kèm) ra thư mục người dùng chọn; không ghi đè. */
export function ExportDialog({
  channel,
  video,
  renderId,
  onClose,
}: {
  channel: string;
  video: string;
  renderId?: string;
  onClose: () => void;
}) {
  const [renders, setRenders] = useState<Render[] | null>(null);
  const [pick, setPick] = useState(renderId ?? '');
  const [name, setName] = useState('');
  const [dir, setDir] = useState(() => load(DIR_KEY, ''));
  const [inc, setInc] = useState<Include>(() =>
    load(INC_KEY, { thumbnail: false, captions: false, description: false }),
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<Result>();

  useEffect(() => {
    void core
      .call('render.list', { channel, video })
      .then((r) => {
        setRenders(r.renders);
        setPick(
          (p) =>
            p || (r.renders.find((x) => x.mode === 'release') ?? r.renders[0])?.render_id || '',
        );
      })
      .catch(() => setRenders([]));
  }, [channel, video]);

  const choose = async () => {
    const d = await window.studioflow.pickFolder();
    if (d) setDir(d);
  };
  const run = async () => {
    setBusy(true);
    setErr('');
    try {
      const r = await core.call('video.export', {
        channel,
        video,
        dest_dir: dir,
        ...(pick ? { render_id: pick } : {}),
        include: inc,
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      save(DIR_KEY, dir);
      save(INC_KEY, inc);
      setDone(r);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const base = (f: string) => f.split(/[\\/]/).pop();

  return (
    <div className="modal" onClick={onClose}>
      <div
        className="card export-dialog"
        role="dialog"
        aria-label="Xuất video"
        data-testid="export-dialog"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Xuất video</h2>
        {renders === null ? (
          <p className="muted">Đang tải…</p>
        ) : !renders.length ? (
          <>
            <p className="muted" data-testid="export-empty">
              Video chưa có bản render nào. Render nháp hoặc phát hành ở tab Xem trước rồi xuất.
            </p>
            <button onClick={onClose}>Đóng</button>
          </>
        ) : done ? (
          <>
            <p className="success">
              Đã lưu {done.files.length} file vào {done.dir}
            </p>
            <ul className="list">
              {done.files.map((f) => (
                <li key={f}>{base(f)}</li>
              ))}
            </ul>
            {done.skipped.length > 0 && (
              <p className="muted">
                Bỏ qua: {done.skipped.map((s) => SKIPPED[s] ?? s).join(', ')}.
              </p>
            )}
            <div className="row">
              <button
                className="primary"
                onClick={() => void window.studioflow.revealFile(done.files[0]!)}
              >
                Mở thư mục
              </button>
              <button onClick={onClose}>Đóng</button>
            </div>
          </>
        ) : (
          <>
            <label className="field">
              <span>Bản render</span>
              <select value={pick} onChange={(e) => setPick(e.target.value)}>
                {renders.map((r) => (
                  <option key={r.render_id} value={r.render_id}>
                    {r.mode === 'release' ? 'Phát hành' : 'Nháp (có chữ NHÁP)'} · {r.output_profile}{' '}
                    · {when(r.finished_at)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Tên file</span>
              <input
                placeholder="Mặc định: tiêu đề video"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="field">
              <span>Thư mục</span>
              <span className="row">
                <input
                  data-testid="export-dir"
                  placeholder="Chọn thư mục để lưu"
                  value={dir}
                  onChange={(e) => setDir(e.target.value)}
                />
                <button onClick={() => void choose()}>Chọn…</button>
              </span>
            </label>
            <fieldset className="export-extras">
              <legend>Kèm theo</legend>
              {EXTRAS.map((x) => (
                <label key={x.id} className="check">
                  <input
                    type="checkbox"
                    checked={inc[x.id]}
                    onChange={(e) => setInc((v) => ({ ...v, [x.id]: e.target.checked }))}
                  />
                  {x.label}
                </label>
              ))}
            </fieldset>
            <p className="muted">File trùng tên không bị ghi đè — app thêm số (2), (3)….</p>
            {err && <p className="error">{err}</p>}
            <div className="row">
              <button
                className="primary"
                data-testid="export-run"
                disabled={busy || !dir.trim()}
                onClick={() => void run()}
              >
                {busy ? 'Đang xuất…' : 'Xuất'}
              </button>
              <button onClick={onClose}>Hủy</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
