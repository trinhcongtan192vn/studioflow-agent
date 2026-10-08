import { useEffect, useState } from 'react';
import { core } from './rpc';
import { AsPage, Surface } from './Surface';
import { channelSummary } from './autopilot-format';
import { ChannelSettings } from './ChannelSettings';

type Managed = Awaited<ReturnType<typeof core.call<'channels.managed'>>>['channels'][number];

/**
 * Quản lý tất cả kênh (047/048): kênh đang quản lý với công tắc Autopilot / Manual, tạm dừng Autopilot,
 * cài đặt kênh, mở thư mục kênh, tạo kênh mới. Mở từ bộ chọn kênh trên sidebar (048: không còn trang chủ riêng).
 */
export function ChannelsOverview({
  onOpen,
  onClose,
}: {
  onOpen: (dir: string) => void;
  onClose: () => void;
}) {
  const [channels, setChannels] = useState<Managed[]>([]);
  const [paused, setPaused] = useState(false);
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [name, setName] = useState('');

  const load = async () => {
    setChannels((await core.call('channels.managed', {})).channels);
    const s = (await core.call('settings.get', {})) as { config: Record<string, unknown> };
    setPaused(s.config['autopilot.paused'] === true);
  };
  useEffect(() => {
    void load();
  }, []);

  const open = async (dir: string) => {
    try {
      await core.call('channel.open', { channel: dir });
      onOpen(dir);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const pickAndOpen = async () => {
    const dir = await window.studioflow.pickFolder();
    if (dir) await open(dir);
  };
  const create = async () => {
    const dir = await window.studioflow.pickFolder();
    if (!dir || !name.trim()) return;
    try {
      await core.call('channel.init', { channel: dir, name: name.trim(), language: 'vi' });
      onOpen(dir);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const setMode = async (c: Managed, on: boolean) => {
    try {
      await core.call('channel.autopilot.set', {
        channel: c.path,
        key: 'autopilot.enabled',
        value: on,
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const anyAutopilot = channels.some((c) => c.autopilot);

  return (
    <Surface
      label="Quản lý kênh"
      className="channels-overview"
      testId="channels-overview"
      onClose={onClose}
    >
      <section>
        <div className="row">
          <h2>Kênh đang quản lý</h2>
          {anyAutopilot && (
            <label className="autopilot-pause" data-testid="autopilot-pause">
              <input
                type="checkbox"
                checked={paused}
                onChange={async (e) => {
                  await core.call('settings.set', {
                    key: 'autopilot.paused',
                    value: e.target.checked,
                  });
                  setPaused(e.target.checked);
                }}
              />
              Tạm dừng Autopilot (mọi kênh)
            </label>
          )}
        </div>
        <ul className="list managed-channels" data-testid="managed-channels">
          {channels.map((c) => (
            <li key={c.path} className={`managed${c.autopilot ? ' autopilot' : ''}`}>
              <div>
                <button className="link" disabled={!c.exists} onClick={() => void open(c.path)}>
                  <b>{c.name}</b>
                </button>{' '}
                <span className={`badge${c.autopilot ? ' on' : ''}`}>
                  {c.autopilot ? (paused ? 'Autopilot (tạm dừng)' : 'Autopilot') : 'Manual'}
                </span>
                <div className="muted" title={c.path}>
                  {channelSummary(c)} · {c.path}
                </div>
              </div>
              <div className="row">
                <label title="Bật Autopilot cho kênh này">
                  <input
                    type="checkbox"
                    data-testid="channel-autopilot"
                    checked={c.autopilot}
                    disabled={!c.exists}
                    onChange={(e) => void setMode(c, e.target.checked)}
                  />
                  Autopilot
                </label>
                <button
                  className="link"
                  disabled={!c.exists}
                  onClick={() => setSettingsFor(c.path)}
                >
                  Cài đặt kênh
                </button>
                <button
                  className="link muted"
                  title="Bỏ khỏi danh sách (không xóa thư mục)"
                  onClick={async () => {
                    await core.call('channels.managed.remove', { channel: c.path });
                    await load();
                  }}
                >
                  Bỏ
                </button>
              </div>
            </li>
          ))}
          {!channels.length && <li className="muted">Chưa có kênh nào.</li>}
        </ul>
        <button onClick={() => void pickAndOpen()}>Mở thư mục kênh…</button>
      </section>
      <section>
        <h2>Tạo kênh mới</h2>
        <input placeholder="Tên kênh" value={name} onChange={(e) => setName(e.target.value)} />
        <button disabled={!name.trim()} onClick={() => void create()}>
          Chọn thư mục và tạo
        </button>
      </section>
      {error && <p className="error">{error}</p>}
      <button onClick={onClose}>Đóng</button>
      {settingsFor && (
        <AsPage.Provider value={false}>
          <ChannelSettings
            channel={settingsFor}
            onClose={() => {
              setSettingsFor(null);
              void load();
            }}
          />
        </AsPage.Provider>
      )}
    </Surface>
  );
}
