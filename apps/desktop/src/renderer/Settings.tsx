import { useEffect, useRef, useState, type ReactNode } from 'react';
import { percentToShare, shareToPercent } from './autopilot-format';
import { TelegramSettings } from './Connections';
import { Icon, type IconName } from './Icon';
import { core } from './rpc';
import { Surface } from './Surface';
import { applyTheme, loadTheme, type Theme } from './theme';

const LABEL: Record<string, string> = {
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  anthropic: 'Anthropic (dự phòng)',
  dashscope_api_key: 'Qwen-Image API (DashScope)',
  youtube_api_key: 'YouTube Data API v3 (video tham khảo)',
  youtube_oauth_client_id: 'OAuth Client ID (đăng video)',
  youtube_oauth_client_secret: 'OAuth Client Secret (đăng video)',
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
  const [autostart, setAutostart] = useState(false);
  // 076: ngân sách Claude/ngày — đặt tay hoặc để app tự học (hiện số đang dùng)
  const [cap, setCap] = useState<{ daily: number | null; source: string; videos: number }>();
  const loadCap = () =>
    void core
      .call('autopilot.capacity', {})
      .then((c) =>
        setCap({ daily: c.daily_tokens, source: c.daily_tokens_source, videos: c.videos }),
      )
      .catch(() => setCap(undefined));
  useEffect(() => {
    loadCap();
    void window.studioflow.getAutostart().then(setAutostart);
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
        Ngân sách Claude mỗi ngày (token) — để trống cho app tự học từ lần chạm hạn mức
        <input
          key={`d${String(cfg['autopilot.daily_tokens'] ?? '')}`}
          type="number"
          min={0}
          step={10000}
          data-testid="daily-tokens"
          placeholder="tự học"
          defaultValue={
            cfg['autopilot.daily_tokens'] == null ? '' : String(cfg['autopilot.daily_tokens'])
          }
          onBlur={(e) => {
            const v = e.target.value.trim();
            void save(
              'autopilot.daily_tokens',
              v === '' ? null : Math.max(0, Math.round(Number(v))),
            ).then(loadCap);
          }}
        />
        {cap && (
          <span className="muted">
            {cap.daily
              ? `Đang dùng ≈ ${cap.daily.toLocaleString('vi-VN')} token/ngày (${cap.source === 'override' ? 'đặt tay' : 'tự học'})`
              : 'Chưa biết ngân sách (chưa chạm hạn mức lần nào) — không giới hạn theo token'}
            {` · hôm nay làm được ${cap.videos} video`}
          </span>
        )}
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
      <label className="field">
        <input
          type="checkbox"
          data-testid="autopilot-background"
          checked={cfg['autopilot.background'] !== false}
          onChange={(e) => void save('autopilot.background', e.target.checked)}
        />{' '}
        Chạy nền khi đóng cửa sổ (ẩn xuống khay hệ thống, Autopilot vẫn làm video)
      </label>
      <label className="field">
        <input
          type="checkbox"
          data-testid="autostart"
          checked={autostart}
          onChange={async (e) => {
            setAutostart(await window.studioflow.setAutostart(e.target.checked));
          }}
        />{' '}
        Khởi động cùng Windows (mở thẳng xuống khay)
      </label>
      {msg && <p className={msg.tone === 'error' ? 'error' : 'success'}>{msg.text}</p>}
    </div>
  );
}

const THEMES: { id: Theme; label: string; icon: IconName }[] = [
  { id: 'dark', label: 'Tối', icon: 'moon' },
  { id: 'light', label: 'Sáng', icon: 'sun' },
  { id: 'system', label: 'Theo Windows', icon: 'monitor' },
];

/** 067: Tối (mặc định) / Sáng / Theo Windows — đổi ngay, nhớ theo máy. */
function ThemePicker() {
  const [t, setT] = useState<Theme>(loadTheme);
  return (
    <div className="segmented" role="radiogroup" aria-label="Giao diện">
      {THEMES.map((x) => (
        <button
          key={x.id}
          role="radio"
          aria-checked={t === x.id}
          className={t === x.id ? 'active' : ''}
          onClick={() => {
            applyTheme(x.id);
            setT(x.id);
          }}
        >
          <Icon name={x.icon} /> {x.label}
        </button>
      ))}
    </div>
  );
}

/** 071: nhóm khóa API theo việc dùng (token Telegram ở mục Kết nối). */
const KEY_GROUPS: { label: string; names: string[] }[] = [
  { label: 'AI viết / dự phòng', names: ['openai', 'deepseek', 'anthropic'] },
  { label: 'Ảnh', names: ['dashscope_api_key'] },
  {
    label: 'YouTube',
    names: ['youtube_api_key', 'youtube_oauth_client_id', 'youtube_oauth_client_secret'],
  },
];
const HIDDEN_KEYS = new Set(['telegram_bot_token']);
const MODELS = [
  'claude/claude-sonnet-5-5',
  'claude/claude-opus-5-5',
  'claude/claude-haiku-4-5-20251001',
  'openai/gpt-5',
  'deepseek/deepseek-chat',
];

const SECTIONS = [
  { id: 'look', label: 'Giao diện' },
  { id: 'connect', label: 'Kết nối' },
  { id: 'keys', label: 'Khóa API' },
  { id: 'models', label: 'Model AI' },
  { id: 'autopilot', label: 'Autopilot' },
  { id: 'storage', label: 'Lưu trữ' },
  { id: 'advanced', label: 'Nâng cao' },
  { id: 'about', label: 'Giới thiệu' },
] as const;

function Keys() {
  const [secrets, setSecrets] = useState<{ name: string; hint: string | null }[]>([]);
  const [value, setValue] = useState<Record<string, string>>({});
  const load = () => void window.studioflow.secretsStatus().then(setSecrets);
  useEffect(load, []);
  const save = async (name: string) => {
    if (!value[name]) return;
    await window.studioflow.secretsSet(name, value[name]);
    setValue((v) => ({ ...v, [name]: '' }));
    load();
  };
  const shown = secrets.filter((s) => !HIDDEN_KEYS.has(s.name));
  const grouped = new Set(KEY_GROUPS.flatMap((g) => g.names));
  const groups = [
    ...KEY_GROUPS.map((g) => ({ ...g, items: shown.filter((s) => g.names.includes(s.name)) })),
    { label: 'Khác', names: [], items: shown.filter((s) => !grouped.has(s.name)) },
  ].filter((g) => g.items.length);
  return (
    <div className="keys">
      <p className="muted">
        Khóa lưu trong Windows Credential Manager, chỉ hiện 4 ký tự cuối. Claude dùng tài khoản đã
        đăng nhập, không cần khóa.
      </p>
      {groups.map((g) => (
        <div key={g.label} className="key-group">
          <div className="section-label">{g.label}</div>
          {g.items.map((s) => (
            <div key={s.name} className="key-row">
              <span className="key-name">{LABEL[s.name] ?? s.name}</span>
              <span className={`key-hint ${s.hint ? 'on' : ''}`}>
                {s.hint ? `••••${s.hint.slice(-4)}` : 'chưa có'}
              </span>
              <input
                type="password"
                placeholder={s.hint ? 'Dán để thay' : 'Dán khóa'}
                aria-label={`Khóa ${LABEL[s.name] ?? s.name}`}
                value={value[s.name] ?? ''}
                onChange={(e) => setValue((v) => ({ ...v, [s.name]: e.target.value }))}
              />
              <button disabled={!value[s.name]} onClick={() => void save(s.name)}>
                Lưu
              </button>
              {s.hint && (
                <button
                  className="ghost"
                  onClick={() => void window.studioflow.secretsDelete(s.name).then(load)}
                >
                  Xóa
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** 083: ba vai model text (D4 mục 4.3): viết, chấm (phải khác model viết), phụ. Trống = mặc định của app. */
const MODEL_ROLES = [
  {
    key: 'text.producer',
    label: 'Model viết',
    hint: 'Viết kịch bản, storyboard, mô tả. Mặc định: OpenAI nếu có khóa, không thì Claude Sonnet.',
    placeholder: 'claude/claude-sonnet-5-5',
  },
  {
    key: 'text.critic',
    label: 'Model chấm',
    hint: 'Chấm điểm và góp ý bản nháp; phải khác model viết. Mặc định: Claude Opus.',
    placeholder: 'claude/claude-opus-5-5',
  },
  {
    key: 'text.aux',
    label: 'Model phụ',
    hint: 'Việc nhỏ (tóm tắt, đặt tên…). Mặc định: Claude Haiku.',
    placeholder: 'claude/claude-haiku-4-5',
  },
] as const;
type ModelKey = (typeof MODEL_ROLES)[number]['key'];

function Models() {
  const [vals, setVals] = useState<Record<ModelKey, string>>({
    'text.producer': '',
    'text.critic': '',
    'text.aux': '',
  });
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string }>();
  useEffect(() => {
    void core.call('settings.get', {}).then((s) => {
      const c = (s as { config: Record<string, unknown> }).config;
      setVals({
        'text.producer': String(c['text.producer'] ?? ''),
        'text.critic': String(c['text.critic'] ?? ''),
        'text.aux': String(c['text.aux'] ?? ''),
      });
    });
  }, []);
  const save = async () => {
    const p = vals['text.producer'].trim() || 'claude/claude-sonnet-5-5';
    const c = vals['text.critic'].trim() || 'claude/claude-opus-5-5';
    if (p === c) {
      setMsg({ tone: 'error', text: 'Model chấm phải khác model viết.' });
      return;
    }
    try {
      for (const r of MODEL_ROLES)
        await core.call('settings.set', { key: r.key, value: vals[r.key].trim() || null });
      setMsg({ tone: 'success', text: 'Đã lưu.' });
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    }
  };
  return (
    <div className="models" data-testid="model-settings">
      <datalist id="sf-models">
        {MODELS.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      {MODEL_ROLES.map((r) => (
        <label className="field" key={r.key}>
          {r.label} (nhà cung cấp/model)
          <input
            list="sf-models"
            data-testid={`model-${r.key.slice(5)}`}
            placeholder={`Mặc định — ${r.placeholder}`}
            value={vals[r.key]}
            onChange={(e) => setVals((v) => ({ ...v, [r.key]: e.target.value }))}
          />
          <span className="muted">{r.hint}</span>
        </label>
      ))}
      <p className="muted">
        OpenAI và DeepSeek cần khóa API ở mục Khóa API và tính tiền theo token. Agent trong chat và
        Autopilot luôn chạy bằng Claude.
      </p>
      <div className="row">
        <button className="primary" onClick={() => void save()}>
          Lưu
        </button>
        {msg && <span className={msg.tone}>{msg.text}</span>}
      </div>
    </div>
  );
}

function About() {
  const [st, setSt] = useState<Awaited<ReturnType<typeof core.call<'app.status'>>>>();
  useEffect(() => {
    void core.call('app.status', {}).then(setSt);
  }, []);
  if (!st) return <p className="muted">Đang tải…</p>;
  return (
    <dl className="kv about">
      <div>
        <dt>Phiên bản lõi</dt>
        <dd>{st.core_version}</dd>
      </div>
      <div>
        <dt>Claude</dt>
        <dd>{st.auth.ok ? `Đã đăng nhập (${st.auth.method})` : 'Chưa đăng nhập'}</dd>
      </div>
      <div>
        <dt>Thành phần còn thiếu</dt>
        <dd>{st.install.missing.length ? st.install.missing.join(', ') : 'Không'}</dd>
      </div>
      <div>
        <dt>Dữ liệu app</dt>
        <dd>
          <button className="link" onClick={() => void window.studioflow.openPath(st.app_data_dir)}>
            {st.app_data_dir}
          </button>
        </dd>
      </div>
    </dl>
  );
}

/** UI-09 Cài đặt app (071): mục lục bên trái, mỗi mục một khối; bấm mục lục → cuộn tới. */
export function Settings({ onClose, channel }: { onClose: () => void; channel?: string }) {
  const [active, setActive] = useState<string>('look');
  const body = useRef<HTMLDivElement>(null);
  const go = (id: string) => {
    setActive(id);
    body.current
      ?.querySelector(`#set-${id}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const section = (id: (typeof SECTIONS)[number]['id'], children: ReactNode, hint?: string) => (
    <section id={`set-${id}`} className="set-section">
      <h3>{SECTIONS.find((x) => x.id === id)!.label}</h3>
      {hint && <p className="muted">{hint}</p>}
      {children}
    </section>
  );
  return (
    <Surface label="Cài đặt" className="settings" testId="settings" onClose={onClose}>
      <div className="set-top">
        <h2>Cài đặt</h2>
        <button onClick={onClose}>Đóng</button>
      </div>
      <div className="set-layout">
        <nav className="set-nav" aria-label="Mục cài đặt">
          {SECTIONS.map((x) => (
            <button key={x.id} className={active === x.id ? 'active' : ''} onClick={() => go(x.id)}>
              {x.label}
            </button>
          ))}
        </nav>
        <div className="set-body" ref={body}>
          {section('look', <ThemePicker />)}
          {section(
            'connect',
            <TelegramSettings />,
            'Kết nối YouTube / TikTok / Facebook theo từng kênh: Cài đặt kênh → Đăng video.',
          )}
          {section('keys', <Keys />)}
          {section('models', <Models />)}
          {section('autopilot', <AutopilotApp />)}
          {section('storage', <Storage {...(channel ? { channel } : {})} />)}
          {section('advanced', <Phoenix />, 'Trace chi tiết của agent và workflow để gỡ lỗi.')}
          {section('about', <About />)}
        </div>
      </div>
    </Surface>
  );
}
