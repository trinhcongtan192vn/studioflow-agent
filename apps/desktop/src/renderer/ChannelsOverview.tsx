import { useEffect, useState } from 'react';
import { core } from './rpc';
import { AsPage, Surface } from './Surface';
import { Icon } from './Icon';
import { ChannelSettings, LANG_LABEL } from './ChannelSettings';

type Managed = Awaited<ReturnType<typeof core.call<'channels.managed'>>>['channels'][number];
type Lang = keyof typeof LANG_LABEL;

/**
 * Quản lý kênh (047/048; 082 bố cục thẻ): công tắc Autopilot toàn cục, thẻ từng kênh (chế độ, ngôn ngữ, đối
 * thủ, thư mục) với Mở kênh / Cài đặt / Autopilot / Bỏ khỏi danh sách; thêm thư mục kênh có sẵn; tạo kênh mới
 * (tên + ngôn ngữ).
 */
export function ChannelsOverview({
  current,
  onOpen,
  onClose,
}: {
  /** Kênh đang mở (đánh dấu trên thẻ). */
  current?: string | null;
  onOpen: (dir: string) => void;
  onClose: () => void;
}) {
  const [channels, setChannels] = useState<Managed[]>([]);
  const [paused, setPaused] = useState(false);
  const [settingsFor, setSettingsFor] = useState<string | null>(null);
  const [removing, setRemoving] = useState<Managed | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [lang, setLang] = useState<Lang>('vi');

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
      await core.call('channel.init', { channel: dir, name: name.trim(), language: lang });
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
  const norm = (p: string) =>
    p
      .replace(/[\\/]+/g, '/')
      .replace(/\/$/, '')
      .toLowerCase();

  return (
    <Surface
      label="Quản lý kênh"
      className="channels-overview"
      testId="channels-overview"
      onClose={onClose}
    >
      <div className="set-top">
        <h2>Kênh</h2>
        <div className="row">
          <button className="primary" onClick={() => setCreating((x) => !x)}>
            <Icon name="plus" /> Tạo kênh mới
          </button>
          <button onClick={() => void pickAndOpen()}>
            <Icon name="folder" /> Thêm thư mục kênh có sẵn…
          </button>
          <button className="ghost" onClick={onClose}>
            Đóng
          </button>
        </div>
      </div>

      {creating && (
        <section className="set-section create-channel" aria-label="Tạo kênh mới">
          <h3>Tạo kênh mới</h3>
          <div className="row">
            <label className="field">
              Tên kênh
              <input
                autoFocus
                placeholder="ví dụ: Sử Việt"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="field">
              Ngôn ngữ
              <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
                {(Object.keys(LANG_LABEL) as Lang[]).map((l) => (
                  <option key={l} value={l}>
                    {LANG_LABEL[l]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="muted">Bấm tạo rồi chọn thư mục (trống) để lưu kênh.</p>
          <div className="row">
            <button className="primary" disabled={!name.trim()} onClick={() => void create()}>
              Chọn thư mục và tạo
            </button>
            <button className="ghost" onClick={() => setCreating(false)}>
              Hủy
            </button>
          </div>
        </section>
      )}

      {anyAutopilot && (
        <label
          className={`autopilot-pause${paused ? ' paused' : ''}`}
          data-testid="autopilot-pause"
        >
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
          <span>
            <b>{paused ? 'Autopilot đang tạm dừng (mọi kênh)' : 'Autopilot đang chạy'}</b>
            <span className="muted">
              {paused
                ? 'Bỏ tích để các kênh bật Autopilot làm video tiếp.'
                : 'Tích để tạm dừng Autopilot của mọi kênh (video đang làm dở vẫn làm xong).'}
            </span>
          </span>
        </label>
      )}

      {error && <p className="error">{error}</p>}

      <ul className="channel-grid" data-testid="managed-channels">
        {channels.map((c) => {
          const isCurrent = Boolean(current && norm(current) === norm(c.path));
          return (
            <li
              key={c.path}
              className={`channel-card${c.autopilot ? ' autopilot' : ''}${isCurrent ? ' current' : ''}${c.exists ? '' : ' missing'}`}
            >
              <div className="cc-head">
                <span className="avatar">{c.name.slice(0, 1).toUpperCase()}</span>
                <span className="grow">
                  <b className="cc-name">{c.name}</b>
                  <span className="muted cc-path" title={c.path}>
                    {c.path}
                  </span>
                </span>
                <button
                  className="ghost icon-only"
                  title="Bỏ khỏi danh sách (không xóa thư mục)"
                  aria-label={`Bỏ ${c.name} khỏi danh sách`}
                  onClick={() => setRemoving(c)}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
              <div className="cc-badges">
                <span className={`badge ${c.autopilot ? 'on' : 'fmt'}`}>
                  {c.autopilot ? (paused ? 'Autopilot (tạm dừng)' : 'Autopilot') : 'Manual'}
                </span>
                <span className="badge fmt">{LANG_LABEL[c.language as Lang] ?? c.language}</span>
                {c.competitors > 0 && <span className="badge fmt">{c.competitors} đối thủ</span>}
                {isCurrent && <span className="badge">Đang mở</span>}
                {!c.exists && <span className="badge warn">Không tìm thấy thư mục</span>}
              </div>
              <div className="cc-actions">
                <button
                  className="primary"
                  disabled={!c.exists || isCurrent}
                  onClick={() => void open(c.path)}
                >
                  {isCurrent ? 'Đang mở' : 'Mở kênh'}
                </button>
                <button disabled={!c.exists} onClick={() => setSettingsFor(c.path)}>
                  <Icon name="settings" /> Cài đặt
                </button>
                <label className="cc-switch" title="Bật Autopilot cho kênh này">
                  <input
                    type="checkbox"
                    data-testid="channel-autopilot"
                    checked={c.autopilot}
                    disabled={!c.exists}
                    onChange={(e) => void setMode(c, e.target.checked)}
                  />
                  Autopilot
                </label>
              </div>
            </li>
          );
        })}
        {!channels.length && (
          <li className="muted empty-state">
            Chưa có kênh nào. Tạo kênh mới hoặc thêm thư mục kênh có sẵn.
          </li>
        )}
      </ul>

      {removing && (
        <div className="modal" onClick={() => setRemoving(null)}>
          <div
            className="card"
            role="alertdialog"
            aria-label="Bỏ kênh khỏi danh sách"
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Bỏ "{removing.name}" khỏi danh sách?</h3>
            <p className="muted">
              Thư mục kênh và video không bị xóa. Autopilot của kênh này ngừng chạy. Thêm lại bằng
              "Thêm thư mục kênh có sẵn…".
            </p>
            <div className="row">
              <button
                className="danger"
                onClick={async () => {
                  await core.call('channels.managed.remove', { channel: removing.path });
                  setRemoving(null);
                  await load();
                }}
              >
                Bỏ khỏi danh sách
              </button>
              <button onClick={() => setRemoving(null)}>Hủy</button>
            </div>
          </div>
        </div>
      )}
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
