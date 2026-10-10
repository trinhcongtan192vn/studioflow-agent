import { useEffect, useState } from 'react';
import { mediaUrl } from './media-url';
import { core } from './rpc';

type Design = NonNullable<Awaited<ReturnType<typeof core.call<'design.get'>>>['design']>;
type Data = Awaited<ReturnType<typeof core.call<'design.get'>>>;

const LAYOUTS = [
  'image-title',
  'image-caption',
  'image-split',
  'image-zoom-detail',
  'split-text',
  'stat-pop',
  'big-text',
  'list',
  'quote',
  'chart-bar',
];
const FONTS = [
  'system-ui, sans-serif',
  'sans-serif',
  'Arial, sans-serif',
  'Segoe UI, sans-serif',
  'Georgia, serif',
  'serif',
  'Times New Roman, serif',
  'monospace',
];
const SPEEDS = [0.8, 0.85, 0.9, 0.95, 1, 1.05, 1.1, 1.15, 1.2];
const SPEED_NOTE: Record<number, string> = {
  0.85: '— chậm rãi (tài liệu)',
  1: '— như giọng mẫu',
  1.1: '— nhanh (shorts)',
};
const COLOR_LABEL: Record<keyof Design['colors'], string> = {
  canvas: 'Nền',
  surface: 'Bề mặt',
  ink: 'Chữ chính',
  muted: 'Chữ phụ',
  accent: 'Nhấn 1',
  accent2: 'Nhấn 2',
};
const STYLE_LABEL: Record<keyof Design['image_style'], string> = {
  medium: 'Chất liệu',
  lighting: 'Ánh sáng',
  palette: 'Bảng màu ảnh',
  camera: 'Máy quay / bố cục',
  avoid: 'Không bao giờ có',
};

/** Khung mẫu theo design: ảnh mẫu + lớp tối màu nền + tiêu đề (ink) + chữ nhấn (accent), đúng font/kiểu chữ. */
export function DesignPreview({ d, image }: { d: Design; image?: string }) {
  const title = d.text.case === 'upper' ? 'HOW RUBBER WAS TAMED' : 'How rubber was tamed';
  return (
    <div
      className="ds-preview"
      style={{ background: d.colors.canvas, fontFamily: d.fonts.title }}
      data-testid="ds-preview"
    >
      {image && <img src={mediaUrl(image)} alt="" />}
      <div
        className="ds-scrim"
        style={{
          background: `linear-gradient(180deg, ${d.colors.canvas}f2, ${d.colors.canvas}66 70%, transparent)`,
        }}
      />
      <div className="ds-text">
        <b style={{ color: d.colors.ink, fontWeight: d.text.weight }}>{title}</b>
        <span style={{ color: d.colors.accent, fontWeight: d.text.weight }}>3,000 YEARS</span>
        <small style={{ color: d.colors.muted, fontFamily: d.fonts.body }}>Ancient Mexico</small>
      </div>
      <div className="ds-swatches">
        {Object.values(d.colors).map((c, i) => (
          <i key={i} style={{ background: c }} />
        ))}
      </div>
    </div>
  );
}

/**
 * Design system của kênh (2026-10-10): mọi video của kênh theo bản này — màu/chữ của khung hình, phong cách ảnh
 * khóa cho mọi ảnh, layout/nhịp ưu tiên, nhạc. AI (Opus) đề xuất 3 phương án kèm ảnh mẫu; chọn rồi chỉnh tay.
 */
export function DesignSystemPanel({ channel }: { channel: string }) {
  const [data, setData] = useState<Data>();
  const [edit, setEdit] = useState<Design>();
  const [job, setJob] = useState<{ id: string; text: string }>();
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string }>();
  const load = () =>
    void core.call('design.get', { channel }).then((r) => {
      setData(r);
      setEdit(r.design);
    });
  useEffect(load, [channel]);
  useEffect(() => {
    if (!job) return;
    return core.on('job.updated', (j) => {
      if (j.id !== job.id) return;
      if (j.status === 'queued' || j.status === 'running') {
        setJob({ id: j.id, text: j.progress.message ?? 'Đang chạy…' });
        load();
        return;
      }
      setJob(undefined);
      load();
      setMsg(
        j.status === 'succeeded'
          ? { tone: 'success', text: 'AI đã đề xuất xong — chọn một phương án bên dưới.' }
          : { tone: 'error', text: j.error?.message ?? 'Đề xuất lỗi.' },
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job?.id]);
  const img = (d?: Design) => (d?.sample_asset_id ? data?.images[d.sample_asset_id] : undefined);
  const propose = async () => {
    setMsg(undefined);
    try {
      const r = await core.call('design.propose', { channel });
      setJob({ id: r.job_id, text: 'AI đang đề xuất design system…' });
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    }
  };
  const choose = async (i: number) => {
    try {
      const d = await core.call('design.choose', { channel, index: i });
      setMsg({
        tone: 'success',
        text: `Đã chọn "${d.name}". Video mới theo design này; video đang làm có nút áp dụng ở tab Xem trước.`,
      });
      load();
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    }
  };
  const save = async () => {
    if (!edit) return;
    try {
      await core.call('design.save', { channel, design: edit });
      setMsg({ tone: 'success', text: 'Đã lưu design system của kênh.' });
      load();
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    }
  };
  if (!data) return <p className="muted">Đang tải…</p>;
  const set = <K extends keyof Design>(k: K, v: Design[K]) =>
    setEdit((e) => (e ? { ...e, [k]: v } : e));
  const toggle = (list: string[], x: string) =>
    list.includes(x) ? list.filter((y) => y !== x) : [...list, x];
  return (
    <div className="ds-panel" data-testid="design-system">
      {msg && <p className={msg.tone === 'error' ? 'error' : 'success'}>{msg.text}</p>}
      <div className="row">
        <button className="primary" disabled={!!job} onClick={() => void propose()}>
          ✨ AI đề xuất phương án
        </button>
        {job && <span className="muted">{job.text}</span>}
      </div>
      {data.proposals.length > 0 && (
        <div className="ds-proposals">
          {data.proposals.map((p, i) => (
            <div key={i} className="ds-card">
              <DesignPreview d={p} image={img(p)} />
              <b>{p.name}</b>
              {p.rationale && <p className="muted">{p.rationale}</p>}
              <p className="ds-style">
                🎨 {p.image_style.medium}; {p.image_style.lighting}
              </p>
              {p.voice && (
                <p className="ds-style">
                  🎙 Đọc {p.voice.speed}× · nghỉ {p.voice.pause_ms} ms · 🎵 {p.music.mood || '—'}
                </p>
              )}
              <button disabled={data.design?.name === p.name} onClick={() => void choose(i)}>
                {data.design?.name === p.name ? 'Đang dùng' : 'Chọn phương án này'}
              </button>
            </div>
          ))}
        </div>
      )}
      {!edit ? (
        <p className="muted">
          Kênh chưa có design system — video đang dùng mẫu mặc định của app. Bấm “AI đề xuất phương
          án” để tạo.
        </p>
      ) : (
        <div className="ds-edit">
          <h4>Đang dùng: {edit.name}</h4>
          <DesignPreview d={edit} image={img(data.design)} />
          <div className="ds-grid">
            <fieldset className="ds-colors">
              <legend>Màu</legend>
              {(Object.keys(COLOR_LABEL) as (keyof Design['colors'])[]).map((k) => (
                <label key={k} className="field inline">
                  <input
                    type="color"
                    value={edit.colors[k]}
                    onChange={(e) => set('colors', { ...edit.colors, [k]: e.target.value })}
                  />
                  {COLOR_LABEL[k]}
                </label>
              ))}
            </fieldset>
            <fieldset>
              <legend>Chữ</legend>
              <label className="field">
                Font tiêu đề
                <select
                  value={edit.fonts.title}
                  onChange={(e) => set('fonts', { ...edit.fonts, title: e.target.value })}
                >
                  {[...new Set([edit.fonts.title, ...FONTS])].map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                Font thân
                <select
                  value={edit.fonts.body}
                  onChange={(e) => set('fonts', { ...edit.fonts, body: e.target.value })}
                >
                  {[...new Set([edit.fonts.body, ...FONTS])].map((f) => (
                    <option key={f}>{f}</option>
                  ))}
                </select>
              </label>
              <label className="field inline">
                <input
                  type="checkbox"
                  checked={edit.text.case === 'upper'}
                  onChange={(e) =>
                    set('text', { ...edit.text, case: e.target.checked ? 'upper' : 'sentence' })
                  }
                />
                Chữ trên hình viết hoa
              </label>
              <label className="field">
                Độ đậm
                <select
                  value={edit.text.weight}
                  onChange={(e) => set('text', { ...edit.text, weight: Number(e.target.value) })}
                >
                  {[500, 600, 700, 800, 900].map((w) => (
                    <option key={w}>{w}</option>
                  ))}
                </select>
              </label>
            </fieldset>
          </div>
          <fieldset>
            <legend>Phong cách ảnh (khóa cho mọi ảnh của kênh)</legend>
            {(Object.keys(STYLE_LABEL) as (keyof Design['image_style'])[]).map((k) => (
              <label key={k} className="field">
                {STYLE_LABEL[k]}
                <textarea
                  rows={2}
                  value={edit.image_style[k]}
                  onChange={(e) => set('image_style', { ...edit.image_style, [k]: e.target.value })}
                />
              </label>
            ))}
          </fieldset>
          <fieldset>
            <legend>Layout</legend>
            <div className="ds-chips">
              {LAYOUTS.map((l) => {
                const pref = edit.layouts.prefer.includes(l);
                const avoid = edit.layouts.avoid.includes(l);
                return (
                  <button
                    key={l}
                    className={`chip-btn${pref ? ' on' : avoid ? ' off' : ''}`}
                    title="Bấm: ưu tiên → cấm → bình thường"
                    onClick={() =>
                      set(
                        'layouts',
                        pref
                          ? {
                              prefer: toggle(edit.layouts.prefer, l),
                              avoid: [...edit.layouts.avoid, l],
                            }
                          : avoid
                            ? { ...edit.layouts, avoid: toggle(edit.layouts.avoid, l) }
                            : { ...edit.layouts, prefer: [...edit.layouts.prefer, l] },
                      )
                    }
                  >
                    {pref ? '★ ' : avoid ? '✕ ' : ''}
                    {l}
                  </button>
                );
              })}
            </div>
          </fieldset>
          <div className="ds-grid">
            <label className="field">
              Nhịp
              <select
                value={edit.motion.pace}
                onChange={(e) =>
                  set('motion', {
                    ...edit.motion,
                    pace: e.target.value as Design['motion']['pace'],
                  })
                }
              >
                <option value="calm">Chậm</option>
                <option value="medium">Vừa</option>
                <option value="fast">Nhanh</option>
              </select>
            </label>
            <label className="field">
              Tâm trạng nhạc mặc định
              <input
                value={edit.music.mood}
                onChange={(e) => set('music', { mood: e.target.value })}
              />
            </label>
          </div>
          <fieldset>
            <legend>Giọng đọc (áp dụng tự động ở bước Giọng đọc)</legend>
            <div className="ds-grid">
              <label className="field">
                Tốc độ đọc
                <select
                  value={String(edit.voice?.speed ?? 1)}
                  onChange={(e) =>
                    set('voice', {
                      pause_ms: edit.voice?.pause_ms ?? 0,
                      speed: Number(e.target.value),
                    })
                  }
                >
                  {SPEEDS.map((s) => (
                    <option key={s} value={String(s)}>
                      {s}× {SPEED_NOTE[s] ?? ''}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                Nghỉ sau mỗi câu (ms)
                <input
                  type="number"
                  min={0}
                  max={1500}
                  step={50}
                  value={edit.voice?.pause_ms ?? 0}
                  onChange={(e) =>
                    set('voice', {
                      speed: edit.voice?.speed ?? 1,
                      pause_ms: Number(e.target.value),
                    })
                  }
                />
              </label>
            </div>
            <p className="muted">
              Giọng mẫu của kênh đọc khoảng 180 từ/phút; 0.85× + nghỉ 300 ms ≈ 150–160 từ/phút (phim
              tài liệu). Đổi nhịp → video chưa phát hành có nút áp dụng (đọc lại cả lời).
            </p>
          </fieldset>
          <div className="row">
            <button className="primary" onClick={() => void save()}>
              Lưu design system
            </button>
            <button onClick={() => setEdit(data.design)}>Bỏ thay đổi</button>
          </div>
        </div>
      )}
    </div>
  );
}
