import { useEffect, useRef, useState } from 'react';
import { core } from './rpc';

type Msg = { tone: 'error' | 'success'; text: string } | undefined;
type TgStatus = Awaited<ReturnType<typeof core.call<'telegram.status'>>>;
type YtStatus = Awaited<ReturnType<typeof core.call<'publish.youtube.status'>>>;
type SocialStatus = Awaited<ReturnType<typeof core.call<'publish.tiktok.status'>>>;

const TG_STATE: Record<TgStatus['state'], string> = {
  running: 'Đang chạy',
  stopped: 'Đang dừng',
  disabled: 'Đang tắt',
};

/** 071: bot Telegram (cấp app) — token, nhóm nhận tin, người được ra lệnh, bật/tắt, gửi tin thử. */
export function TelegramSettings() {
  const [st, setSt] = useState<TgStatus>();
  const [cfg, setCfg] = useState<Record<string, unknown>>({});
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState<Msg>();
  const load = () => {
    void core
      .call('telegram.status', {})
      .then(setSt)
      .catch(() => setSt(undefined));
    void core
      .call('settings.get', {})
      .then((s) => setCfg((s as { config: Record<string, unknown> }).config));
  };
  useEffect(load, []);
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setMsg({ tone: 'success', text: ok });
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    }
    load();
  };
  const save = (key: string, value: unknown) =>
    act(() => core.call('settings.set', { key, value }), 'Đã lưu.');
  const ids = Array.isArray(cfg['telegram.allowed_user_ids'])
    ? (cfg['telegram.allowed_user_ids'] as string[]).join(', ')
    : '';
  return (
    <div className="connection" data-testid="telegram-settings">
      <div className="conn-head">
        <b>Telegram</b>
        {st && (
          <span className={`conn-state ${st.state === 'running' ? 'on' : ''}`}>
            {TG_STATE[st.state]}
            {st.bot_username ? ` · @${st.bot_username}` : ''}
          </span>
        )}
      </div>
      <p className="muted">
        Nhận báo cáo, duyệt / phản đối đăng video và ra lệnh cho Autopilot qua một nhóm Telegram.
        {st?.reason ? ` ${st.reason}` : ''}
      </p>
      <label className="field">
        Bot token {st?.has_token ? '(đã có — dán để thay)' : '(lấy từ @BotFather)'}
        <span className="row">
          <input
            type="password"
            placeholder="123456:ABC…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <button
            disabled={!token.trim()}
            onClick={() =>
              void act(async () => {
                await core.call('telegram.set_token', { token: token.trim() });
                setToken('');
              }, 'Đã lưu token.')
            }
          >
            Lưu
          </button>
        </span>
      </label>
      <label className="field">
        Chat ID của nhóm
        <input
          key={`c${String(cfg['telegram.chat_id'] ?? '')}`}
          defaultValue={String(cfg['telegram.chat_id'] ?? '')}
          placeholder="-100…"
          onBlur={(e) => {
            const v = e.target.value.trim();
            if (v !== String(cfg['telegram.chat_id'] ?? ''))
              void save('telegram.chat_id', v || null);
          }}
        />
      </label>
      <label className="field">
        Người được ra lệnh (ID người dùng Telegram, cách nhau dấu phẩy; trống = mọi thành viên nhóm)
        <input
          key={`u${ids}`}
          defaultValue={ids}
          onBlur={(e) => {
            const list = e.target.value
              .split(/[,\s]+/)
              .map((x) => x.trim())
              .filter(Boolean);
            if (list.join(', ') !== ids) void save('telegram.allowed_user_ids', list);
          }}
        />
      </label>
      <label className="field">
        <input
          type="checkbox"
          data-testid="telegram-enabled"
          checked={cfg['telegram.enabled'] === true}
          onChange={(e) => void save('telegram.enabled', e.target.checked)}
        />
        Bật bot Telegram
      </label>
      <div className="row">
        <button
          disabled={st?.state !== 'running'}
          onClick={() => void act(() => core.call('telegram.test', {}), 'Đã gửi tin thử vào nhóm.')}
        >
          Gửi tin thử
        </button>
        {st?.last_error && <span className="error">{st.last_error}</span>}
      </div>
      {msg && <p className={msg.tone}>{msg.text}</p>}
    </div>
  );
}

/** 071: kết nối tài khoản đăng video của một kênh — YouTube (đăng nhập Google), TikTok/Facebook (token). */
export function ChannelConnections({ channel }: { channel: string }) {
  const [yt, setYt] = useState<YtStatus>();
  const [social, setSocial] = useState<Record<'tiktok' | 'facebook', SocialStatus | undefined>>({
    tiktok: undefined,
    facebook: undefined,
  });
  const [tokens, setTokens] = useState({ tiktok: '', facebook: '', page: '' });
  const [waiting, setWaiting] = useState(false);
  const [msg, setMsg] = useState<Msg>();
  const poll = useRef<number>();
  const load = () => {
    void core
      .call('publish.youtube.status', { channel })
      .then((s) => {
        setYt(s);
        if (s.connected) setWaiting(false);
      })
      .catch((e) => setMsg({ tone: 'error', text: (e as Error).message }));
    for (const pf of ['tiktok', 'facebook'] as const)
      void core
        .call(`publish.${pf}.status`, { channel })
        .then((s) => setSocial((x) => ({ ...x, [pf]: s })))
        .catch(() => {});
  };
  useEffect(() => {
    load();
    const off = core.on('publish.updated', (e) => {
      if (e.channel === channel) load();
    });
    return () => {
      off();
      window.clearInterval(poll.current);
    };
  }, [channel]);
  useEffect(() => {
    window.clearInterval(poll.current);
    // chờ người dùng đăng nhập Google xong (tối đa 5 phút)
    if (waiting) {
      const until = Date.now() + 5 * 60_000;
      poll.current = window.setInterval(() => {
        if (Date.now() > until) setWaiting(false);
        else load();
      }, 3000);
    }
  }, [waiting]);
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      setMsg({ tone: 'success', text: ok });
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    }
    load();
  };
  const connect = () =>
    act(async () => {
      const { auth_url } = await core.call('publish.youtube.connect', { channel });
      await window.studioflow.openExternal(auth_url);
      setWaiting(true);
    }, 'Đã mở trang đăng nhập Google trong trình duyệt — đăng nhập và cho phép, app tự nhận kết nối.');

  return (
    <div className="connections" data-testid="channel-connections">
      <div className="connection">
        <div className="conn-head">
          <b>YouTube</b>
          <span className={`conn-state ${yt?.connected ? 'on' : ''}`}>
            {yt?.connected
              ? `Đã kết nối${yt.channel_title ? ` · ${yt.channel_title}` : ''}`
              : waiting
                ? 'Đang chờ đăng nhập…'
                : 'Chưa kết nối'}
          </span>
        </div>
        {yt && (
          <p className="muted">
            Hạn mức API hôm nay: {yt.quota.used.toLocaleString('vi-VN')} /{' '}
            {yt.quota.limit.toLocaleString('vi-VN')} đơn vị.
            {!yt.audited &&
              ' Dự án API chưa được Google kiểm duyệt: video tải lên ở chế độ riêng tư, bạn công khai trong YouTube Studio.'}
            {yt.error ? ` ${yt.error}` : ''}
          </p>
        )}
        <div className="row">
          {yt?.connected ? (
            <button
              className="danger"
              onClick={() =>
                void act(
                  () => core.call('publish.youtube.disconnect', { channel }),
                  'Đã ngắt kết nối YouTube.',
                )
              }
            >
              Ngắt kết nối
            </button>
          ) : (
            <button
              className="primary"
              data-testid="youtube-connect"
              onClick={() => void connect()}
            >
              {waiting ? 'Mở lại trang đăng nhập' : 'Kết nối YouTube'}
            </button>
          )}
        </div>
      </div>
      {(['tiktok', 'facebook'] as const).map((pf) => {
        const s = social[pf];
        return (
          <div key={pf} className="connection">
            <div className="conn-head">
              <b>{pf === 'tiktok' ? 'TikTok' : 'Facebook'}</b>
              <span className={`conn-state ${s?.connected ? 'on' : ''}`}>
                {s?.connected
                  ? `Đã kết nối${s.page_id ? ` · trang ${s.page_id}` : ''}`
                  : 'Chưa kết nối'}
              </span>
            </div>
            {s?.connected ? (
              <button
                className="danger"
                onClick={() =>
                  void act(
                    () => core.call(`publish.${pf}.disconnect`, { channel }),
                    'Đã ngắt kết nối.',
                  )
                }
              >
                Ngắt kết nối
              </button>
            ) : (
              <div className="row">
                <input
                  type="password"
                  placeholder={pf === 'tiktok' ? 'Access token TikTok' : 'Page access token'}
                  value={tokens[pf]}
                  onChange={(e) => setTokens((t) => ({ ...t, [pf]: e.target.value }))}
                />
                {pf === 'facebook' && (
                  <input
                    placeholder="Page ID"
                    value={tokens.page}
                    onChange={(e) => setTokens((t) => ({ ...t, page: e.target.value }))}
                  />
                )}
                <button
                  disabled={!tokens[pf].trim()}
                  onClick={() =>
                    void act(async () => {
                      if (pf === 'tiktok')
                        await core.call('publish.tiktok.set_token', {
                          channel,
                          token: tokens.tiktok.trim(),
                        });
                      else
                        await core.call('publish.facebook.set_token', {
                          channel,
                          token: tokens.facebook.trim(),
                          ...(tokens.page.trim() ? { page_id: tokens.page.trim() } : {}),
                        });
                      setTokens({ tiktok: '', facebook: '', page: '' });
                    }, 'Đã lưu token.')
                  }
                >
                  Lưu
                </button>
              </div>
            )}
          </div>
        );
      })}
      {msg && (
        <p className={msg.tone} role="status">
          {msg.text}
        </p>
      )}
    </div>
  );
}
