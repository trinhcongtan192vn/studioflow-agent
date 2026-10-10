import { useEffect, useState } from 'react';
import { mediaUrl } from './media-url';
import { core } from './rpc';

type Host = NonNullable<Awaited<ReturnType<typeof core.call<'channel.host.get'>>>['host']>;

/**
 * Nhân vật dẫn chuyện của kênh (2026-10-10): ảnh tải lên (png/jpg/webp/jfif) làm người dẫn xuất hiện trong cảnh;
 * mọi nhân vật mới của kênh (vd. nhân vật lịch sử trong câu chuyện) được vẽ theo phong cách tạo hình của ảnh này.
 */
export function HostPanel({ channel }: { channel: string }) {
  const [host, setHost] = useState<Host | null>();
  const [name, setName] = useState('');
  const [look, setLook] = useState('');
  const [file, setFile] = useState<string>();
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string }>();
  useEffect(() => {
    void core.call('channel.host.get', { channel }).then((r) => {
      setHost(r.host);
      setName(r.host?.name ?? '');
      setLook(r.host?.look ?? '');
    });
  }, [channel]);
  const pick = async () => {
    const [p] = await window.studioflow.pickFiles();
    if (!p) return;
    if (!/\.(png|jpe?g|jfif|webp)$/i.test(p)) {
      setMsg({ tone: 'error', text: 'Chọn ảnh png, jpg, webp hoặc jfif.' });
      return;
    }
    setFile(p);
    setMsg(undefined);
  };
  const save = async () => {
    try {
      const r = await core.call('channel.host.set', {
        channel,
        name: name || 'Host',
        look,
        ...(file ? { path_on_disk: file } : {}),
      });
      setHost(r.host);
      setFile(undefined);
      setMsg({
        tone: 'success',
        text: 'Đã lưu nhân vật dẫn chuyện — video mới dùng từ bước Đạo diễn hình.',
      });
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    }
  };
  if (host === undefined) return <p className="muted">Đang tải…</p>;
  return (
    <div className="host-panel" data-testid="host-panel">
      {msg && <p className={msg.tone === 'error' ? 'error' : 'success'}>{msg.text}</p>}
      <div className="host-row">
        <div className="host-img">
          {host?.image && !file ? (
            <img src={mediaUrl(host.image)} alt="" />
          ) : (
            <span className="muted">{file ? file.split(/[\\/]/).pop() : 'Chưa có ảnh'}</span>
          )}
        </div>
        <div className="host-fields">
          <button onClick={() => void pick()}>
            {host ? 'Đổi ảnh tham chiếu…' : 'Tải ảnh nhân vật…'}
          </button>
          <label className="field">
            Tên
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Host" />
          </label>
          <label className="field">
            Ngoại hình (tiếng Anh, tùy chọn — để trống thì theo ảnh)
            <textarea
              rows={2}
              value={look}
              onChange={(e) => setLook(e.target.value)}
              placeholder="round-faced cartoon owl with big glasses, teal scarf"
            />
          </label>
          <button className="primary" disabled={!host && !file} onClick={() => void save()}>
            Lưu nhân vật dẫn chuyện
          </button>
        </div>
      </div>
    </div>
  );
}
