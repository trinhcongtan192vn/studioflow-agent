import { useEffect, useRef, useState } from 'react';

/** "m:ss" cho thời lượng audio. */
export function fmtClock(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00';
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Trình phát âm thanh trong app (008): main đọc file được phép qua IPC → blob URL → `<audio>` ẩn;
 * nút ▶/⏸, thời gian, thanh tua. Nạp khi bấm phát lần đầu (nhiều thẻ giọng không tải cùng lúc).
 */
export function AudioPlayer({
  src,
  label,
  autoPlay,
}: {
  src: string;
  label?: string;
  /** Nạp và phát ngay (nút "Nghe thử" đã là thao tác của người dùng). */
  autoPlay?: boolean;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [url, setUrl] = useState<string>();
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [err, setErr] = useState('');
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const pendingPlay = useRef(false);

  // đổi file → bỏ blob cũ
  useEffect(() => {
    setUrl(undefined);
    setState('idle');
    setPlaying(false);
    setCur(0);
    setDur(0);
  }, [src]);
  useEffect(() => () => void (url && URL.revokeObjectURL(url)), [url]);
  useEffect(() => {
    if (autoPlay) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoPlay, src]);

  const load = async () => {
    setState('loading');
    try {
      const r = await window.studioflow.readAudio(src);
      const u = URL.createObjectURL(new Blob([r.data as BlobPart], { type: r.mime }));
      pendingPlay.current = true;
      setUrl(u);
      setState('ready');
    } catch (e) {
      setErr(String((e as Error).message).replace(/^Error invoking remote method '[^']+': /, ''));
      setState('error');
    }
  };
  const toggle = () => {
    const a = audio.current;
    if (!url) return void load();
    if (!a) return;
    if (a.paused) void a.play().catch((e: Error) => (setErr(e.message), setState('error')));
    else a.pause();
  };

  return (
    <div className={`audio-player ${state}`} data-testid="audio-player">
      <button
        className="ap-btn"
        onClick={toggle}
        disabled={state === 'loading'}
        aria-label={playing ? 'Tạm dừng' : `Phát${label ? ` ${label}` : ''}`}
        title={playing ? 'Tạm dừng' : 'Phát'}
      >
        {state === 'loading' ? '…' : playing ? '⏸' : '▶'}
      </button>
      <input
        className="ap-seek"
        type="range"
        min={0}
        max={dur || 0}
        step={0.01}
        value={cur}
        disabled={!dur}
        aria-label="Tua"
        onChange={(e) => {
          const a = audio.current;
          if (a) a.currentTime = Number(e.target.value);
          setCur(Number(e.target.value));
        }}
      />
      <span className="ap-time" data-testid="audio-time">
        {fmtClock(cur)} / {fmtClock(dur)}
      </span>
      {state === 'error' && <span className="error ap-err">Không phát được: {err}</span>}
      {url && (
        <audio
          ref={audio}
          src={url}
          preload="auto"
          onLoadedMetadata={(e) => {
            setDur(e.currentTarget.duration);
            if (pendingPlay.current) {
              pendingPlay.current = false;
              void e.currentTarget.play().catch(() => {});
            }
          }}
          onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={(e) => {
            setPlaying(false);
            e.currentTarget.currentTime = 0;
            setCur(0);
          }}
          onError={() => {
            setErr('định dạng không hỗ trợ');
            setState('error');
          }}
        />
      )}
    </div>
  );
}
