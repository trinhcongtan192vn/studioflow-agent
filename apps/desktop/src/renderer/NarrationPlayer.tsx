import { useEffect, useState } from 'react';
import { AudioPlayer } from './AudioPlayer';
import { core } from './rpc';

/** Nghe thử cả lời đọc của video (core ghép audio các line thành một file, dựng lại khi audio đổi). */
export function NarrationPlayer({
  channel,
  video,
  autoPlay,
}: {
  channel: string;
  video: string;
  autoPlay?: boolean;
}) {
  const [file, setFile] = useState<string>();
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    setFile(undefined);
    setErr('');
    core
      .call('voice.preview', { channel, video })
      .then((r) => live && setFile(r.file))
      .catch((e: Error) => live && setErr(e.message));
    return () => {
      live = false;
    };
  }, [channel, video]);
  if (err) return <span className="error">Không nghe thử được: {err}</span>;
  if (!file) return <span className="muted">Đang ghép lời đọc…</span>;
  return <AudioPlayer src={file} label="cả lời đọc" autoPlay={autoPlay} />;
}
