import { useEffect, useRef, useState } from 'react';
import { AudioPlayer, fmtClock } from './AudioPlayer';
import { mediaUrl } from './media-url';
import { NarrationPlayer } from './NarrationPlayer';
import { core } from './rpc';

type Review = Awaited<ReturnType<typeof core.call<'video.review'>>>;
type Voices = Awaited<ReturnType<typeof core.call<'voice.speakers'>>>;
type Step = { id: string; title: string; status: string; uses?: string };

const sec = (ms?: number) => (ms ? fmtClock(ms / 1000) : '');

/**
 * Xem lại kết quả từng bước đã xong (tab Xem trước): video, giọng đọc (đổi giọng theo người nói), các cảnh,
 * nhạc, ảnh chụp frame. Tự làm mới khi workflow của video đổi trạng thái.
 */
export function ReviewPanel({ channel, video }: { channel: string; video: string }) {
  const [data, setData] = useState<Review>();
  const [voices, setVoices] = useState<Voices>();
  const [steps, setSteps] = useState<Step[]>([]);
  const [design, setDesign] = useState<Awaited<ReturnType<typeof core.call<'design.status'>>>>();
  const [designMsg, setDesignMsg] = useState('');
  const [err, setErr] = useState('');
  const [viewing, setViewing] = useState<number>();
  // video đang xem: phản hồi về muộn của video trước (đổi video khi đang tải) bị bỏ
  const current = useRef(video);
  current.current = video;
  const load = () => {
    const v = video;
    const mine =
      <T,>(f: (x: T) => void) =>
      (x: T) => {
        if (current.current === v) f(x);
      };
    void core
      .call('video.review', { channel, video: v })
      .then(mine(setData))
      .catch(mine((e: Error) => setErr(e.message)));
    void core
      .call('voice.speakers', { channel, video: v })
      .then(mine(setVoices))
      .catch(() => {});
    void core
      .call('design.status', { channel, video: v })
      .then(mine(setDesign))
      .catch(() => {});
    void core
      .call('workflow.state', { channel, video: v })
      .then(mine((s) => setSteps(s.steps as Step[])))
      .catch(mine(() => setSteps([])));
  };
  useEffect(() => {
    setViewing(undefined);
    setData(undefined);
    setVoices(undefined);
    setDesign(undefined);
    setDesignMsg('');
    setErr('');
    setSteps([]);
    load();
    return core.on('workflow.updated', (s) => {
      if (s.video_id === video) load();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, video]);
  if (err) return <p className="error">{err}</p>;
  if (!data) return <p className="muted">Đang tải kết quả…</p>;
  const done = (uses: string) =>
    steps.some(
      (s) => (s.uses ?? s.id) === uses && (s.status === 'done' || s.status === 'waiting_approval'),
    );
  const video0 = data.release ?? data.draft;
  // mọi ảnh xem phóng to được (theo thứ tự cảnh, rồi ảnh chụp frame) — lướt bằng ←/→
  const gallery = [...data.shots.flatMap((s) => s.images), ...data.snapshots];
  const openViewer = (f: string) => setViewing(Math.max(0, gallery.indexOf(f)));
  return (
    <div className="review" data-testid="review">
      <StepStrip steps={steps} />
      {design?.stale && !design.released && (
        <div className="design-banner" data-testid="design-banner">
          <span>
            Kênh đã đổi design system <b>{design.design}</b> — video này đang theo bản cũ.
          </span>
          <button
            className="primary"
            onClick={() =>
              void core
                .call('design.apply_video', { channel, video })
                .then((r) =>
                  setDesignMsg(
                    design.voice
                      ? 'Đang đọc lại lời theo nhịp đọc mới (rồi làm lại các bước sau).'
                      : design.images
                        ? `Đang làm lại từ “Đạo diễn hình” (ảnh theo phong cách mới)${r.step ? '' : ''}.`
                        : 'Đang dựng lại hình với màu/chữ mới.',
                  ),
                )
                .catch((e: Error) => setDesignMsg(e.message))
            }
          >
            {design.voice
              ? 'Áp dụng (đọc lại giọng)'
              : design.images
                ? 'Áp dụng (sinh lại ảnh)'
                : 'Áp dụng (dựng lại hình)'}
          </button>
          {designMsg && <span className="muted">{designMsg}</span>}
        </div>
      )}
      {video0 && (
        <section className="review-sec">
          <h3>
            🎬 {data.release ? 'Bản phát hành' : 'Bản nháp để duyệt'}
            <span className="muted"> · {sec(video0.duration_ms)}</span>
          </h3>
          <video className="review-video" src={mediaUrl(video0.file)} controls preload="metadata" />
        </section>
      )}
      {(data.script.lines.some((l) => l.audio) || voices) && (
        <VoiceSection
          channel={channel}
          video={video}
          data={data}
          voices={voices}
          onChanged={load}
        />
      )}
      {data.shots.length > 0 && (
        <section className="review-sec">
          <h3>
            🖼 Cảnh <span className="muted">· {data.shots.length} cảnh</span>
          </h3>
          <div className={`shot-list${data.vertical ? ' vertical' : ''}`}>
            {data.shots.map((s, i) => (
              <div key={s.frame_id} className="shot-row" data-testid="shot">
                <div className="shot-thumbs">
                  {s.images.length ? (
                    s.images.map((f, k) => (
                      <button
                        key={f}
                        className="shot-thumb"
                        title="Phóng to"
                        onClick={() => openViewer(f)}
                      >
                        <img src={mediaUrl(f)} alt="" loading="lazy" />
                        {k === 0 && <span className="shot-no">{i + 1}</span>}
                      </button>
                    ))
                  ) : (
                    <span className="shot-thumb empty muted">
                      <span className="shot-no">{i + 1}</span>
                      {s.pending_prompts.length ? 'Chờ ảnh' : 'Chữ'}
                    </span>
                  )}
                </div>
                <div className="shot-info">
                  <div className="shot-meta">
                    {s.duration_ms ? <span className="muted">{sec(s.duration_ms)}</span> : null}
                    {s.layout && <span className="chip">{s.layout}</span>}
                    {s.motion && <span className="chip muted">{s.motion}</span>}
                    {s.texts.length > 0 && <b className="shot-text">{s.texts.join(' · ')}</b>}
                  </div>
                  <p className="shot-lines" title={s.pending_prompts[0] ?? ''}>
                    {s.line_ids
                      .map((id) => data.script.lines.find((l) => l.id === id)?.text)
                      .filter(Boolean)
                      .join(' ')}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {done('media') && data.music.length > 0 && (
        <section className="review-sec">
          <h3>🎵 Nhạc nền</h3>
          <ul className="plain">
            {data.music.map((m, i) => (
              <li key={i}>
                <b>{m.scene}</b>:{' '}
                {m.none ? (
                  <span className="muted">không nhạc</span>
                ) : m.track ? (
                  <>
                    {m.track}
                    {m.query && <span className="muted"> — “{m.query}”</span>}
                  </>
                ) : (
                  <span className="muted">chưa chọn (“{m.query}”)</span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {data.snapshots.length > 0 && (
        <section className="review-sec">
          <h3>📸 Ảnh chụp frame</h3>
          <div className="snap-row">
            {data.snapshots.map((f) => (
              <button key={f} className="shot-thumb snap" onClick={() => openViewer(f)}>
                <img src={mediaUrl(f)} alt="" loading="lazy" />
              </button>
            ))}
          </div>
        </section>
      )}
      {viewing !== undefined && gallery[viewing] && (
        <ImageViewer
          files={gallery}
          index={viewing}
          caption={(f) => {
            const i = data.shots.findIndex((s) => s.images.includes(f));
            const s = data.shots[i];
            return s
              ? `Cảnh ${i + 1}${s.texts.length ? ` · ${s.texts.join(' · ')}` : ''}`
              : 'Ảnh chụp frame';
          }}
          onIndex={setViewing}
          onClose={() => setViewing(undefined)}
        />
      )}
      {!video0 && !data.shots.length && !data.script.lines.some((l) => l.audio) && (
        <p className="muted">Chưa có kết quả để xem — các mục sẽ hiện dần khi từng bước xong.</p>
      )}
    </div>
  );
}

/** Xem ảnh phóng to: ←/→ lướt, Esc hoặc bấm nền để đóng. */
function ImageViewer({
  files,
  index,
  caption,
  onIndex,
  onClose,
}: {
  files: string[];
  index: number;
  caption: (f: string) => string;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const go = (d: number) => onIndex((index + d + files.length) % files.length);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const f = files[index]!;
  return (
    <div
      className="image-viewer"
      role="dialog"
      aria-label="Xem ảnh"
      data-testid="image-viewer"
      onClick={onClose}
    >
      <img src={mediaUrl(f)} alt="" onClick={(e) => e.stopPropagation()} />
      <div className="iv-bar" onClick={(e) => e.stopPropagation()}>
        <button onClick={() => go(-1)} aria-label="Ảnh trước">
          ←
        </button>
        <span>
          {caption(f)}{' '}
          <span className="muted">
            · {index + 1}/{files.length}
          </span>
        </span>
        <button onClick={() => go(1)} aria-label="Ảnh sau">
          →
        </button>
        <button onClick={onClose} aria-label="Đóng">
          ✕
        </button>
      </div>
    </div>
  );
}

/** Dải các bước: đã xong / đang chạy / chờ duyệt / lỗi. */
function StepStrip({ steps }: { steps: Step[] }) {
  if (!steps.length) return null;
  const icon: Record<string, string> = {
    done: '✓',
    running: '…',
    waiting_approval: '⏸',
    failed: '✕',
    skipped: '–',
    stale: '↻',
  };
  return (
    <div className="step-strip">
      {steps.map((s) => (
        <span key={s.id} className={`step-pill ${s.status}`} title={s.status}>
          {icon[s.status] ?? '○'} {s.title}
        </span>
      ))}
    </div>
  );
}

/** Giọng đọc: nghe cả lời, đổi giọng theo người nói (nghe câu mẫu trước khi chọn), nghe từng câu. */
function VoiceSection({
  channel,
  video,
  data,
  voices,
  onChanged,
}: {
  channel: string;
  video: string;
  data: Review;
  voices?: Voices;
  onChanged: () => void;
}) {
  const [pick, setPick] = useState<Record<string, string>>({});
  // người dẫn: mặc định đặt luôn làm giọng của kênh (video sau cũng dùng)
  const [asDefault, setAsDefault] = useState(true);
  const [msg, setMsg] = useState('');
  const [changed, setChanged] = useState(false);
  const [showLines, setShowLines] = useState(false);
  useEffect(() => {
    setPick({});
    setMsg('');
    setChanged(false);
    setShowLines(false);
  }, [video]);
  const hasAudio = data.script.lines.some((l) => l.audio);
  const byId = new Map((voices?.voices ?? []).map((v) => [v.voice_id, v]));
  const apply = async (speaker: string) => {
    const voice_id = pick[speaker];
    if (!voice_id) return;
    try {
      await core.call('voice.assign', {
        channel,
        video,
        speaker,
        voice_id,
        ...(speaker === 'narrator' && asDefault ? { scope: 'channel' as const } : {}),
      });
      setMsg(`Đã đổi giọng cho ${voices?.speakers.find((s) => s.speaker === speaker)?.name}.`);
      setChanged(true);
      onChanged();
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const rerun = async () => {
    try {
      await core.call('workflow.rewind', { channel, video, step_id: 'voice' });
      setMsg('Đang đọc lại bằng giọng mới…');
      setChanged(false);
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  const total = data.script.lines.reduce((a, l) => a + (l.duration_ms ?? 0), 0);
  const lang = (voices?.language ?? '').slice(0, 2).toLowerCase();
  return (
    <section className="review-sec" data-testid="review-voice">
      <div className="voice-top">
        <h3>🎙 Giọng đọc{hasAudio && <span className="muted"> · {sec(total)}</span>}</h3>
        {hasAudio && <NarrationPlayer channel={channel} video={video} />}
        {hasAudio && (
          <button className="link" onClick={() => setShowLines(!showLines)}>
            {showLines ? 'Ẩn từng câu' : `Từng câu (${data.script.lines.length})`}
          </button>
        )}
      </div>
      {voices && (
        <div className="voice-cards">
          {voices.speakers.map((sp) => {
            const sel = pick[sp.speaker] ?? sp.voice_id ?? '';
            const v = byId.get(sel);
            const picked = Boolean(pick[sp.speaker]) && pick[sp.speaker] !== sp.voice_id;
            const wrongLang =
              v?.language && lang && !v.language.toLowerCase().startsWith(lang)
                ? v.language.toUpperCase()
                : '';
            return (
              <div key={sp.speaker} className="voice-card" data-testid="voice-card">
                <span className="voice-head" title={`${sp.lines} câu`}>
                  <b>{sp.name}</b> <span className="muted">· {sp.lines} câu</span>
                </span>
                <select
                  value={sel}
                  aria-label={`Giọng cho ${sp.name}`}
                  onChange={(e) => setPick((p) => ({ ...p, [sp.speaker]: e.target.value }))}
                >
                  {!sel && <option value="">— chọn giọng —</option>}
                  {voices.voices.map((x) => (
                    <option key={x.voice_id} value={x.voice_id} disabled={!x.ready}>
                      {x.language ? `[${x.language.toUpperCase()}] ` : ''}
                      {x.name}
                      {x.kind === 'designed' ? ' (gợi ý)' : ''}
                      {x.ready ? '' : ' — chưa sẵn sàng'}
                    </option>
                  ))}
                </select>
                {v?.ref && <AudioPlayer key={v.ref} src={v.ref} label="câu mẫu" />}
                {picked && (
                  <button className="primary" onClick={() => void apply(sp.speaker)}>
                    Dùng
                  </button>
                )}
                {picked && sp.speaker === 'narrator' && (
                  <label className="field inline muted">
                    <input
                      type="checkbox"
                      checked={asDefault}
                      onChange={(e) => setAsDefault(e.target.checked)}
                    />
                    mặc định của kênh
                  </label>
                )}
                {!sp.voice_id && !picked && <span className="error">chưa có giọng</span>}
                {wrongLang && (
                  <span className="error">
                    giọng {wrongLang}, video nói {lang.toUpperCase()}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
      {voices && !voices.voices.length && (
        <p className="muted">Kênh chưa có giọng ref nào — nhờ agent tạo giọng trong chat.</p>
      )}
      {(msg || changed) && (
        <div className="row">
          {msg && <span>{msg}</span>}
          {changed && (
            <button className="primary" onClick={() => void rerun()}>
              ↻ Đọc lại bằng giọng mới
            </button>
          )}
        </div>
      )}
      {hasAudio && (
        <>
          {showLines && (
            <div className="line-list">
              {data.script.beats.map((b) => (
                <div key={b.id}>
                  <h4>{b.title}</h4>
                  {data.script.lines
                    .filter((l) => l.beat_id === b.id)
                    .map((l) => (
                      <div key={l.id} className="line-row">
                        {l.audio ? (
                          <AudioPlayer src={l.audio} label={l.text} />
                        ) : (
                          <span className="muted">chưa có audio</span>
                        )}
                        <span className="line-who">{l.speaker_name}</span>
                        <span className="line-text">{l.text}</span>
                      </div>
                    ))}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
