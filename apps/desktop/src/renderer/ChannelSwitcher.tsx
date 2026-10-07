import { useEffect, useState } from 'react';
import { core } from './rpc';

type Managed = Awaited<ReturnType<typeof core.call<'channels.managed'>>>['channels'][number];

/**
 * 048: chọn kênh ngay trên sidebar — kênh đang quản lý (Autopilot/Manual), thêm thư mục kênh, tạo kênh mới,
 * quản lý tất cả kênh, cài đặt kênh. Thay trang chọn kênh riêng.
 */
export function ChannelSwitcher({
  channel,
  refreshKey,
  onSwitch,
  onManage,
  onChannelSettings,
}: {
  channel: string | null;
  refreshKey?: unknown;
  onSwitch: (dir: string) => void;
  onManage: () => void;
  onChannelSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [channels, setChannels] = useState<Managed[]>([]);
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState('');
  const load = () =>
    void core
      .call('channels.managed', {})
      .then((r) => setChannels(r.channels))
      .catch(() => {});
  useEffect(load, [channel, refreshKey, open]);
  const current = channels.find((c) => c.path === channel);

  const openDir = async (dir: string) => {
    try {
      await core.call('channel.open', { channel: dir });
      setError('');
      setOpen(false);
      onSwitch(dir);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const addFolder = async () => {
    const dir = await window.studioflow.pickFolder();
    if (dir) await openDir(dir);
  };
  const create = async () => {
    const name = (creating ?? '').trim();
    if (!name) return;
    const dir = await window.studioflow.pickFolder();
    if (!dir) return;
    try {
      await core.call('channel.init', { channel: dir, name, language: 'vi' });
      setCreating(null);
      await openDir(dir);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="channel-switcher" data-testid="channel-switcher">
      <button
        className="switcher-head"
        data-testid="channel-switcher-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title={channel ?? 'Chọn kênh'}
      >
        <b>{current?.name ?? (channel ? channel.split(/[\\/]/).pop() : 'Chọn kênh')}</b>
        {current && (
          <span className={`badge${current.autopilot ? ' on' : ''}`}>
            {current.autopilot ? 'Autopilot' : 'Manual'}
          </span>
        )}
        <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <div className="switcher-menu" data-testid="channel-menu" role="menu">
          <ul className="list">
            {channels.map((c) => (
              <li key={c.path} className={c.path === channel ? 'active' : ''}>
                <button
                  className="link"
                  role="menuitem"
                  disabled={!c.exists}
                  title={c.path}
                  onClick={() => void openDir(c.path)}
                >
                  {c.name}{' '}
                  <span className={`badge${c.autopilot ? ' on' : ''}`}>
                    {c.autopilot ? 'Autopilot' : 'Manual'}
                  </span>
                  {!c.exists && <span className="muted"> (không thấy thư mục)</span>}
                </button>
              </li>
            ))}
            {!channels.length && <li className="muted">Chưa có kênh.</li>}
          </ul>
          <hr />
          <button className="link" role="menuitem" onClick={() => void addFolder()}>
            + Thêm thư mục kênh…
          </button>
          {creating === null ? (
            <button className="link" role="menuitem" onClick={() => setCreating('')}>
              + Tạo kênh mới…
            </button>
          ) : (
            <div className="row">
              <input
                autoFocus
                placeholder="Tên kênh"
                value={creating}
                onChange={(e) => setCreating(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void create();
                  if (e.key === 'Escape') setCreating(null);
                }}
              />
              <button disabled={!creating.trim()} onClick={() => void create()}>
                Chọn thư mục và tạo
              </button>
            </div>
          )}
          <button
            className="link"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onManage();
            }}
          >
            Quản lý tất cả kênh…
          </button>
          {channel && (
            <button
              className="link"
              role="menuitem"
              data-testid="open-channel-settings"
              onClick={() => {
                setOpen(false);
                onChannelSettings();
              }}
            >
              Cài đặt kênh (Autopilot, đối thủ, lịch đăng)…
            </button>
          )}
          {error && <p className="error">{error}</p>}
        </div>
      )}
    </div>
  );
}
