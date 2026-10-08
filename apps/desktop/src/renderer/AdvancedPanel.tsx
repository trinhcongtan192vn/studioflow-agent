import { useEffect, useState } from 'react';
import {
  ADVANCED,
  advancedSummary,
  choiceValue,
  inheritLabel,
  videoChoice,
  type AdvancedKey,
  type Flag,
  type VideoChoice,
} from './advanced-format';
import { core } from './rpc';

/**
 * 085: tính năng nâng cao (refine, nhạc nền, model mạnh). Không có `video` → công tắc tầng kênh; có `video`
 * → ô chọn Theo kênh / Bật / Tắt cho riêng video đó.
 */
export function AdvancedPanel({ channel, video }: { channel: string; video?: string }) {
  const [flags, setFlags] = useState<Record<AdvancedKey, Flag>>();
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string }>();
  const load = () =>
    core
      .call('advanced.get', { channel, ...(video ? { video } : {}) })
      .then((r) => setFlags(r.flags))
      .catch(() => setFlags(undefined));
  useEffect(() => {
    setMsg(undefined);
    void load();
  }, [channel, video]);
  const set = async (key: AdvancedKey, value: boolean | null) => {
    try {
      await core.call('advanced.set', { channel, ...(video ? { video } : {}), key, value });
      await load();
      setMsg({
        tone: 'success',
        text: video
          ? 'Đã lưu cho video này. Áp dụng cho các bước chưa chạy.'
          : 'Đã lưu cho kênh. Video mới và các bước chưa chạy sẽ dùng giá trị này.',
      });
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    }
  };
  if (!flags) return null;
  const rows = ADVANCED.map((a) => {
    const f = flags[a.key];
    return (
      <div className="adv-row" key={a.key} data-testid={`adv-${a.key.slice(9)}`}>
        <div className="adv-text">
          <b>{a.label}</b>
          <span className="muted">{a.hint}</span>
        </div>
        {video ? (
          <select
            aria-label={a.label}
            value={videoChoice(f)}
            onChange={(e) => void set(a.key, choiceValue(e.target.value as VideoChoice))}
          >
            <option value="inherit">{inheritLabel(f)}</option>
            <option value="on">Bật</option>
            <option value="off">Tắt</option>
          </select>
        ) : (
          <label className="switch">
            <input
              type="checkbox"
              aria-label={a.label}
              checked={f.value}
              onChange={(e) => void set(a.key, e.target.checked)}
            />
            {f.value ? 'Bật' : 'Tắt'}
          </label>
        )}
      </div>
    );
  });
  const body = (
    <>
      {rows}
      {msg && (
        <p className={msg.tone} role="status">
          {msg.text}
        </p>
      )}
    </>
  );
  if (!video) return <div className="advanced">{body}</div>;
  return (
    <details className="advanced" data-testid="advanced">
      <summary>{advancedSummary(flags)}</summary>
      {body}
    </details>
  );
}
