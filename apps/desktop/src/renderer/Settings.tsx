import { useEffect, useState } from 'react';
import { percentToShare, shareToPercent } from './autopilot-format';
import { core } from './rpc';

const LABEL: Record<string, string> = {
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  anthropic: 'Anthropic (dự phòng)',
  dashscope_api_key: 'Qwen-Image API (DashScope)',
  youtube_api_key: 'YouTube Data API v3 (video tham khảo)',
};

type Usage = {
  disk: { free_bytes: number; total_bytes: number; level: 'ok' | 'warn' | 'low' };
  app: { models_bytes: number; providers_bytes: number };
  channel?: {
    cache_bytes: number;
    renders: { draft_bytes: number; release_bytes: number };
    backups_bytes: number;
    reclaimable: Record<'cache' | 'drafts' | 'backups' | 'snapshots', number>;
  };
};
const gb = (b: number) => `${(b / 1e9).toFixed(2)} GB`;
const CLEAN: { id: 'cache' | 'drafts' | 'backups' | 'snapshots'; label: string }[] = [
  { id: 'cache', label: 'Cache (sinh lại được)' },
  { id: 'drafts', label: 'Render nháp cũ (giữ 5 bản mới nhất)' },
  { id: 'snapshots', label: 'Ảnh chụp cũ (giữ 10)' },
  { id: 'backups', label: 'Bản sao lưu' },
];

/** FR-OB-04 (028): bật Phoenix cục bộ để xem trace chi tiết. */
function Phoenix() {
  const [on, setOn] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => {
    void core
      .call('settings.get', {})
      .then((s) =>
        setOn(Boolean((s as { trace?: { phoenix_enabled?: boolean } }).trace?.phoenix_enabled)),
      );
  }, []);
  const toggle = async (enabled: boolean) => {
    setMsg(enabled ? 'Đang khởi động Phoenix…' : '');
    try {
      const r = await core.call('trace.phoenix', { enabled });
      setOn(r.enabled);
      setMsg(r.enabled ? `Phoenix: ${r.url}` : '');
    } catch (e) {
      setOn(false);
      setMsg((e as Error).message);
    }
  };
  return (
    <div className="row" aria-label="Phoenix">
      <label>
        <input type="checkbox" checked={on} onChange={(e) => void toggle(e.target.checked)} /> Gửi
        trace sang Phoenix cục bộ (127.0.0.1:6006)
      </label>
      <span className="muted">{msg}</span>
    </div>
  );
}

/** UI-10 Dung lượng (024): theo kênh đang mở + model của app; nút dọn hiện số byte giải phóng. */
function Storage({ channel }: { channel?: string }) {
  const [u, setU] = useState<Usage>();
  const load = () =>
    void core.call('disk.usage', channel ? { channel } : {}).then((x) => setU(x as Usage));
  useEffect(load, [channel]);
  if (!u) return <p className="muted">Đang tính dung lượng…</p>;
  return (
    <div aria-label="Dung lượng">
      <p className={u.disk.level === 'ok' ? '' : 'error'}>
        Ổ đĩa còn {gb(u.disk.free_bytes)} / {gb(u.disk.total_bytes)}
        {u.disk.level === 'low'
          ? ' — dưới 5 GB: đã tạm dừng sinh/render'
          : u.disk.level === 'warn'
            ? ' — sắp đầy (dưới 15 GB)'
            : ''}
      </p>
      <p className="muted">
        Model: {gb(u.app.models_bytes)} · Môi trường engine: {gb(u.app.providers_bytes)}
      </p>
      {u.channel && (
        <>
          <p className="muted">
            Render phát hành: {gb(u.channel.renders.release_bytes)} (không tự xóa) · Render nháp:{' '}
            {gb(u.channel.renders.draft_bytes)}
          </p>
          {CLEAN.map((c) => (
            <div key={c.id} className="row">
              <span style={{ width: 260 }}>{c.label}</span>
              <span className="muted" style={{ width: 90 }}>
                {gb(u.channel!.reclaimable[c.id])}
              </span>
              <button
                disabled={!u.channel!.reclaimable[c.id]}
                onClick={() =>
                  void core.call('disk.clean', { channel: channel!, targets: [c.id] }).then(load)
                }
              >
                Dọn
              </button>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/** UI-09 Cài đặt (M1): khóa API (chỉ 4 ký tự cuối, lưu Credential Manager ở `main`), model viết. */
/** 047 (FR-AP-03): khung giờ máy làm việc, phần ngân sách Claude cho Autopilot, múi giờ, giờ chờ phản đối. */
function AutopilotApp() {
  const [cfg, setCfg] = useState<Record<string, unknown>>({});
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string }>();
  useEffect(() => {
    void core
      .call('settings.get', {})
      .then((s) => setCfg((s as { config: Record<string, unknown> }).config));
  }, []);
  const save = async (key: string, value: unknown) => {
    try {
      await core.call('settings.set', { key, value });
      setCfg((c) => ({ ...c, [key]: value }));
      setMsg({ tone: 'success', text: 'Đã lưu.' });
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    }
  };
  const str = (k: string, d: string) => (typeof cfg[k] === 'string' ? (cfg[k] as string) : d);
  return (
    <div className="autopilot-app" data-testid="autopilot-app">
      <label className="field">
        Khung giờ máy làm việc mỗi ngày
        <input
          key={`w${str('autopilot.work_window', '08:00-23:00')}`}
          defaultValue={str('autopilot.work_window', '08:00-23:00')}
          placeholder="08:00-23:00"
          onBlur={(e) => void save('autopilot.work_window', e.target.value.trim())}
        />
      </label>
      <label className="field">
        Phần ngân sách Claude cho Autopilot (%)
        <input
          key={`b${shareToPercent(cfg['autopilot.budget_share'] ?? 0.7)}`}
          type="number"
          min={0}
          max={100}
          defaultValue={shareToPercent(cfg['autopilot.budget_share'] ?? 0.7)}
          onBlur={(e) => {
            const v = percentToShare(e.target.value);
            if (v !== undefined) void save('autopilot.budget_share', v);
          }}
        />
        <span className="muted"> phần còn lại để bạn chat/làm tay</span>
      </label>
      <label className="field">
        Múi giờ mặc định
        <input
          key={`t${str('publish.timezone', 'Asia/Ho_Chi_Minh')}`}
          defaultValue={str('publish.timezone', 'Asia/Ho_Chi_Minh')}
          onBlur={(e) => void save('publish.timezone', e.target.value.trim())}
        />
      </label>
      <label className="field">
        Giờ chờ phản đối (Telegram) trước khi công khai
        <input
          key={`v${String(cfg['publish.veto_hours'] ?? 2)}`}
          type="number"
          min={0}
          max={72}
          defaultValue={String(cfg['publish.veto_hours'] ?? 2)}
          onBlur={(e) => void save('publish.veto_hours', Number(e.target.value))}
        />
      </label>
      {msg && <p className={msg.tone === 'error' ? 'error' : 'success'}>{msg.text}</p>}
    </div>
  );
}

export function Settings({ onClose, channel }: { onClose: () => void; channel?: string }) {
  const [secrets, setSecrets] = useState<{ name: string; hint: string | null }[]>([]);
  const [value, setValue] = useState<Record<string, string>>({});
  const [producer, setProducer] = useState('');
  const load = () => void window.studioflow.secretsStatus().then(setSecrets);
  useEffect(() => {
    load();
    void core
      .call('settings.get', {})
      .then((s) =>
        setProducer(
          String((s as { config: Record<string, unknown> }).config['text.producer'] ?? ''),
        ),
      );
  }, []);
  const save = async (name: string) => {
    if (!value[name]) return;
    await window.studioflow.secretsSet(name, value[name]);
    setValue((v) => ({ ...v, [name]: '' }));
    load();
  };
  return (
    <div className="modal" onClick={onClose}>
      <div className="card" onClick={(e) => e.stopPropagation()}>
        <h2>Cài đặt</h2>
        <h3>Khóa API</h3>
        {secrets.map((s) => (
          <div key={s.name} className="row">
            <span style={{ width: 160 }}>{LABEL[s.name] ?? s.name}</span>
            <span className="muted" style={{ width: 80 }}>
              {s.hint ?? 'chưa có'}
            </span>
            <input
              type="password"
              placeholder="Dán khóa"
              value={value[s.name] ?? ''}
              onChange={(e) => setValue((v) => ({ ...v, [s.name]: e.target.value }))}
            />
            <button onClick={() => void save(s.name)}>Lưu</button>
            {s.hint && (
              <button onClick={() => void window.studioflow.secretsDelete(s.name).then(load)}>
                Xóa
              </button>
            )}
          </div>
        ))}
        <h3>Model viết mặc định</h3>
        <div className="row">
          <input
            placeholder="claude/claude-sonnet-5-5"
            value={producer}
            onChange={(e) => setProducer(e.target.value)}
          />
          <button
            onClick={() =>
              void core.call('settings.set', { key: 'text.producer', value: producer || null })
            }
          >
            Lưu
          </button>
        </div>
        <h3>Autopilot</h3>
        <AutopilotApp />
        <h3>Trace</h3>
        <Phoenix />
        <h3>Dung lượng</h3>
        <Storage {...(channel ? { channel } : {})} />
        <button onClick={onClose}>Đóng</button>
      </div>
    </div>
  );
}
