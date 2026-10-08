import { useEffect, useState } from 'react';
import { pickerSummary, publishResultText } from './publish-format';
import { core } from './rpc';

type Options = Awaited<ReturnType<typeof core.call<'publish.video.options'>>>;

/**
 * 091 (FR-UI-91-05): bộ chọn nền tảng của bước "Đăng lên nền tảng" — tích sẵn theo mặc định kênh, lý do khi không
 * chọn được (chưa kết nối, video ngang…), xem trước tiêu đề/mô tả, nút Đăng / Không đăng; bước xong → kết quả.
 */
export function PublishPicker({
  channel,
  video,
  waiting,
  status,
}: {
  channel: string;
  video: string;
  /** Bước đang chờ người dùng chọn. */
  waiting: boolean;
  status: string;
}) {
  const [opt, setOpt] = useState<Options>();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    let live = true;
    core
      .call('publish.video.options', { channel, video })
      .then((o) => {
        if (!live) return;
        setOpt(o);
        setPicked(new Set(o.platforms.filter((p) => p.checked).map((p) => p.platform)));
      })
      .catch((e: Error) => live && setMsg(e.message));
    return () => {
      live = false;
    };
  }, [channel, video, status]);

  if (!opt) return msg ? <div className="step-error">{msg}</div> : null;
  const start = async (platforms: string[]) => {
    setBusy(true);
    setMsg('');
    try {
      await core.call('publish.video.start', { channel, video, platforms });
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const results = opt.platforms.filter((p) => p.state);
  const labels = opt.platforms.filter((p) => picked.has(p.platform)).map((p) => p.label);

  return (
    <div className="publish-picker" data-testid="publish-picker">
      {results.length > 0 && (
        <ul className="pub-results" data-testid="publish-results">
          {results.map((p) => (
            <li key={p.platform} className={`pub-${p.state!.status}`}>
              <b>{p.label}</b>: {publishResultText(p.state!)}
              {p.state!.url && (
                <>
                  {' '}
                  <button
                    className="link"
                    onClick={() => void window.studioflow.openExternal(p.state!.url!)}
                  >
                    Mở
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {waiting && (
        <>
          {!opt.render && <p className="muted">Chưa có bản render phát hành để đăng.</p>}
          <div className="pub-options">
            {opt.platforms.map((p) => {
              const can = p.connected && p.eligible;
              return (
                <label
                  key={p.platform}
                  className={can ? '' : 'disabled'}
                  data-testid={`pub-${p.platform}`}
                >
                  <input
                    type="checkbox"
                    disabled={!can || busy}
                    checked={picked.has(p.platform)}
                    onChange={() => {
                      const next = new Set(picked);
                      if (next.has(p.platform)) next.delete(p.platform);
                      else next.add(p.platform);
                      setPicked(next);
                    }}
                  />
                  {p.label}
                  <span className="muted">
                    {' '}
                    {!p.connected
                      ? '· chưa kết nối — kết nối trong Cài đặt kênh'
                      : !p.eligible
                        ? `· ${p.reason ?? 'không đăng được'}`
                        : ''}
                  </span>
                </label>
              );
            })}
          </div>
          <div className="pub-preview">
            <b>{opt.meta.title}</b>
            {opt.meta.description && (
              <p className="muted">
                {opt.meta.description.slice(0, 220)}
                {opt.meta.description.length > 220 ? '…' : ''}
              </p>
            )}
            {opt.meta.tags.length > 0 && (
              <p className="muted">{opt.meta.tags.map((t) => `#${t}`).join(' ')}</p>
            )}
          </div>
          <div className="row">
            <button
              className="primary"
              data-testid="publish-go"
              disabled={busy || !picked.size || !opt.render}
              onClick={() => void start([...picked])}
            >
              {busy ? 'Đang gửi…' : '📤 Đăng'}
            </button>
            <button disabled={busy} onClick={() => void start([])}>
              Không đăng
            </button>
            <span className="muted">{pickerSummary(labels)}</span>
          </div>
        </>
      )}
      {msg && <div className="step-error">{msg}</div>}
    </div>
  );
}
