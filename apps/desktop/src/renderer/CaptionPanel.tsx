import { useCallback, useEffect, useRef, useState } from 'react';
import { core } from './rpc';
import {
  canSplit,
  dragEdge,
  groupAt,
  History,
  mergeNext,
  newGroupId,
  setText,
  split,
  type Group,
  type Line,
  type Overrides,
  type PanelState,
} from './caption-edit';

interface Loaded {
  groups: Group[];
  overrides: Overrides;
  base_hash: string | null;
  lines: Line[];
  audio: string | null;
  waveform: { step_ms: number; duration_ms: number; peaks: number[] } | null;
  read_only: boolean;
  orphans: string[];
}

const PX_PER_MS = 0.12;
const SAVE_DELAY_MS = 1000;
const mediaUrl = (abs: string) => `sf-media:///${encodeURI(abs.replace(/\\/g, '/'))}`;

/**
 * UI-11 Bảng caption (D9 mục 6, FN-026): trình phát audio lời đọc, dạng sóng, cụm caption kéo mép,
 * tách/gộp, sửa chữ; tự lưu sau 1 giây không thao tác qua `captions.save` (có `base_hash`).
 */
export function CaptionPanel({ channel, video }: { channel: string; video: string }) {
  const [data, setData] = useState<Loaded>();
  const [state, setState] = useState<PanelState>();
  const [sel, setSel] = useState<string>();
  const [msg, setMsg] = useState('');
  const [now, setNow] = useState(0);
  const hist = useRef<History<PanelState>>();
  const base = useRef<string | null>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const audio = useRef<HTMLAudioElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drag = useRef<{ id: string; edge: 'start' | 'end'; x0: number; ms0: number }>();

  const load = useCallback(async () => {
    try {
      const d = (await core.call('captions.load', { channel, video })) as unknown as Loaded;
      setData(d);
      const s = { groups: d.groups, overrides: d.overrides };
      hist.current = new History(s);
      setState(s);
      base.current = d.base_hash;
      dirty.current = false;
      setMsg(
        d.orphans.length
          ? `Có ${d.orphans.length} chỉnh caption không còn khớp cụm (orphan): ${d.orphans.join(', ')}`
          : '',
      );
    } catch (e) {
      setData(undefined);
      setMsg((e as Error).message);
    }
  }, [channel, video]);

  useEffect(() => {
    void load();
    return core.on('artifact.changed', (d) => {
      const p = (d as { path: string }).path;
      if (dirty.current) return;
      if (/(caption_groups|caption-overrides|audio_meta)\.json$/.test(p)) void load();
    });
  }, [load]);

  const save = useCallback(async () => {
    const s = hist.current?.current;
    if (!s) return;
    try {
      const r = await core.call('captions.save', {
        channel,
        video,
        overrides: s.overrides as never,
        base_hash: base.current,
      });
      base.current = r.hash;
      dirty.current = false;
      setMsg('Đã lưu caption.');
    } catch (e) {
      const err = e as Error & { code?: string };
      if (err.code === 'E_BASE_HASH_MISMATCH') {
        await load();
        setMsg('caption-overrides.json đã đổi ở nơi khác — đã tải lại, chỉnh lại nếu cần.');
      } else setMsg(err.message);
    }
  }, [channel, video, load]);

  const apply = useCallback(
    (next: PanelState) => {
      if (!hist.current || data?.read_only || next === hist.current.current) return;
      setState(hist.current.push(next));
      dirty.current = true;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
    },
    [data?.read_only, save],
  );
  const step = (fn: (h: History<PanelState>) => PanelState) => {
    if (!hist.current || data?.read_only) return;
    setState(fn(hist.current));
    dirty.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  // dạng sóng
  useEffect(() => {
    const c = canvas.current;
    const w = data?.waveform;
    if (!c || !w) return;
    c.width = Math.ceil(w.duration_ms * PX_PER_MS);
    const g = c.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = '#6b8afd';
    const mid = c.height / 2;
    w.peaks.forEach((p, i) => {
      const x = i * w.step_ms * PX_PER_MS;
      g.fillRect(x, mid - p * mid, Math.max(1, w.step_ms * PX_PER_MS), Math.max(1, p * c.height));
    });
  }, [data?.waveform]);

  // đầu phát
  useEffect(() => {
    const a = audio.current;
    if (!a) return;
    let raf = 0;
    const tick = () => {
      setNow(a.currentTime * 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [data?.audio]);

  const groups = state?.groups ?? [];
  const seek = (ms: number) => {
    if (audio.current) audio.current.currentTime = Math.max(0, ms) / 1000;
    setNow(ms);
  };
  const jump = (dir: 1 | -1) => {
    const cur = groupAt(groups, now);
    const i = cur ? groups.indexOf(cur) : -1;
    const g = groups[Math.max(0, Math.min(groups.length - 1, i + dir))];
    if (g) {
      setSel(g.id);
      seek(g.start_ms);
    }
  };
  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.key === ' ') {
      e.preventDefault();
      const a = audio.current;
      if (a) void (a.paused ? a.play() : a.pause());
    } else if (e.key === 'ArrowRight') jump(1);
    else if (e.key === 'ArrowLeft') jump(-1);
    else if (e.ctrlKey && e.key.toLowerCase() === 'z') step((h) => h.undo());
    else if (e.ctrlKey && e.key.toLowerCase() === 'y') step((h) => h.redo());
  };

  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d || !state || !data) return;
    const ms = d.ms0 + (e.clientX - d.x0) / PX_PER_MS;
    setState(dragEdge(hist.current!.current, data.lines, d.id, d.edge, ms));
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = undefined;
    if (!d || !data || !hist.current) return;
    const ms = d.ms0 + (e.clientX - d.x0) / PX_PER_MS;
    apply(dragEdge(hist.current.current, data.lines, d.id, d.edge, ms));
  };

  if (!data || !state) return <div className="captions muted">{msg || 'Đang tải caption…'}</div>;
  const selected = groups.find((g) => g.id === sel);
  const line = selected && data.lines.find((l) => l.line_id === selected.line_id);
  const taken = new Set(groups.map((g) => g.id));
  const playing = groupAt(groups, now);
  const width = Math.ceil((data.waveform?.duration_ms ?? 0) * PX_PER_MS);

  return (
    <div className="captions" data-testid="captions" tabIndex={0} onKeyDown={onKey}>
      <div className="row">
        <strong>Caption</strong>
        {data.read_only && <span className="muted">Chỉ đọc — Studio đang chỉnh video này.</span>}
        <button disabled={data.read_only} onClick={() => step((h) => h.undo())}>
          Hoàn tác
        </button>
        <button disabled={data.read_only} onClick={() => step((h) => h.redo())}>
          Làm lại
        </button>
        <span className="muted">{msg}</span>
      </div>
      {data.audio && <audio ref={audio} src={mediaUrl(data.audio)} controls preload="auto" />}
      <p className="caption-now" data-testid="caption-now">
        {playing && now < playing.end_ms ? playing.text : ' '}
      </p>
      <div className="timeline" onPointerMove={onMove} onPointerUp={onUp}>
        <div className="track" style={{ width }}>
          <canvas ref={canvas} height={48} />
          <div
            className="playhead"
            style={{ left: now * PX_PER_MS }}
            onClick={(e) => e.stopPropagation()}
          />
          {groups.map((g) => (
            <div
              key={g.id}
              data-testid={`cg-${g.id}`}
              className={g.id === sel ? 'cg selected' : 'cg'}
              style={{ left: g.start_ms * PX_PER_MS, width: (g.end_ms - g.start_ms) * PX_PER_MS }}
              title={g.text}
              onClick={() => {
                setSel(g.id);
                seek(g.start_ms);
              }}
            >
              {(['start', 'end'] as const).map((edge) => (
                <span
                  key={edge}
                  className={`edge ${edge}`}
                  onPointerDown={(e) => {
                    if (data.read_only) return;
                    e.stopPropagation();
                    (
                      e.currentTarget.parentElement?.parentElement as HTMLElement
                    ).setPointerCapture?.(e.pointerId);
                    drag.current = {
                      id: g.id,
                      edge,
                      x0: e.clientX,
                      ms0: edge === 'start' ? g.start_ms : g.end_ms,
                    };
                  }}
                />
              ))}
              <span className="label">{g.text}</span>
            </div>
          ))}
        </div>
      </div>
      {selected && (
        <div className="cg-edit">
          <label>
            Chữ hiển thị
            <input
              value={selected.text}
              disabled={data.read_only}
              onChange={(e) => apply(setText(state, selected.id, e.target.value))}
            />
          </label>
          <span className="muted">
            {(selected.start_ms / 1000).toFixed(2)}–{(selected.end_ms / 1000).toFixed(2)} s · đổi
            lời đọc thì sửa qua chat
          </span>
          <div className="row">
            Tách trước từ:
            {line?.words
              .slice(selected.word_range[0] + 1, selected.word_range[1] + 1)
              .map((w, k) => {
                const at = selected.word_range[0] + 1 + k;
                return (
                  <button
                    key={at}
                    disabled={data.read_only || !canSplit(state, selected.id, at)}
                    onClick={() =>
                      apply(split(state, data.lines, selected.id, at, newGroupId(taken)))
                    }
                  >
                    {w.text}
                  </button>
                );
              })}
            <button
              disabled={data.read_only}
              onClick={() => apply(mergeNext(state, selected.id, newGroupId(taken)))}
            >
              Gộp với cụm sau
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
