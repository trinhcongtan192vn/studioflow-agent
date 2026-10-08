import { useEffect, useState } from 'react';
import { ChannelConnections } from './Connections';
import { core } from './rpc';
import { Surface } from './Surface';
import {
  compactCount,
  formatList,
  parseList,
  PLATFORM_LABEL,
  sourceLabel,
} from './autopilot-format';

type Settings = Record<string, { value: unknown; source: string }>;
type Card = Awaited<ReturnType<typeof core.call<'youtube.resolve_channel'>>>;

/** Cài đặt kênh (047, FR-AP-01/02): Autopilot ↔ Manual, đối thủ, chủ đề, workflow, lịch đăng. */
export function ChannelSettings({ channel, onClose }: { channel: string; onClose: () => void }) {
  const [s, setS] = useState<Settings>();
  const [workflows, setWorkflows] = useState<{ id: string; title: string }[]>([]);
  const [cards, setCards] = useState<Record<string, Card | null>>({});
  const [adding, setAdding] = useState('');
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string }>();
  // ô nhập dạng chữ (lưu khi bấm Lưu)
  const [pillars, setPillars] = useState('');
  const [slots, setSlots] = useState('');

  const load = async () => {
    const r = await core.call('channel.autopilot.get', { channel });
    setS(r.settings);
    setPillars(formatList(r.settings['autopilot.pillars']?.value));
    setSlots(formatList(r.settings['publish.slots']?.value));
    return r.settings;
  };
  useEffect(() => {
    void load().then((st) => {
      // thẻ đối thủ đã lưu (1 đơn vị quota mỗi kênh)
      for (const id of (st['autopilot.competitors']?.value as string[]) ?? [])
        void core
          .call('youtube.resolve_channel', { input: id })
          .then((c) => setCards((x) => ({ ...x, [id]: c })))
          .catch(() => setCards((x) => ({ ...x, [id]: null })));
    });
    void core.call('workflow.list', {}).then((r) => setWorkflows(r.workflows));
  }, [channel]);

  const set = async (key: string, value: unknown, ok?: string) => {
    // hiện ngay giá trị mới (ô điều khiển không bật lại trạng thái cũ trong lúc chờ lưu)
    const before = s;
    setS((x) => (x ? { ...x, [key]: { value, source: 'channel' } } : x));
    try {
      await core.call('channel.autopilot.set', { channel, key, value });
      await load();
      setMsg(ok ? { tone: 'success', text: ok } : undefined);
      return true;
    } catch (e) {
      setS(before);
      setMsg({ tone: 'error', text: (e as Error).message });
      return false;
    }
  };
  const v = <T,>(k: string) => s?.[k]?.value as T;
  const competitors = v<string[]>('autopilot.competitors') ?? [];

  const addCompetitor = async () => {
    if (!adding.trim()) return;
    try {
      const c = await core.call('youtube.resolve_channel', { input: adding.trim() });
      if (competitors.includes(c.id)) {
        setMsg({ tone: 'error', text: `${c.title} đã có trong danh sách.` });
        return;
      }
      setCards((x) => ({ ...x, [c.id]: c }));
      if (await set('autopilot.competitors', [...competitors, c.id], `Đã thêm ${c.title}.`))
        setAdding('');
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
    }
  };

  if (!s) return null;
  const on = v<boolean>('autopilot.enabled') === true;
  const allowed = v<string[]>('autopilot.workflows') ?? [];
  const platforms = v<string[]>('publish.platforms') ?? [];
  const src = (k: string) => (
    <span className="muted"> ({sourceLabel(s[k]?.source ?? 'default')})</span>
  );

  return (
    <Surface
      label="Cài đặt kênh"
      className="channel-settings"
      testId="channel-settings"
      onClose={onClose}
    >
      <h2>Cài đặt kênh</h2>
      <p className="muted" title={channel}>
        {channel.split(/[\\/]/).pop()}
      </p>

      <h3>Chế độ</h3>
      <div className="row mode-switch" role="radiogroup" aria-label="Chế độ kênh">
        <label>
          <input
            type="radio"
            name="mode"
            checked={!on}
            onChange={() => void set('autopilot.enabled', false, 'Đã chuyển sang Manual.')}
          />
          <b>Manual</b> — bạn ra lệnh, agent làm từng video như hiện tại
        </label>
        <label>
          <input
            type="radio"
            name="mode"
            data-testid="mode-autopilot"
            checked={on}
            onChange={() => void set('autopilot.enabled', true, 'Đã bật Autopilot cho kênh.')}
          />
          <b>Autopilot</b> — mỗi ngày tự tìm chủ đề, lên kế hoạch, làm video và đăng theo lịch
        </label>
      </div>

      <h3>Kênh đối thủ</h3>
      <ul className="list competitors" data-testid="competitors">
        {competitors.map((id) => {
          const c = cards[id];
          return (
            <li key={id} className="row">
              {c?.thumbnail && <img src={c.thumbnail} alt="" width={24} height={24} />}
              <span>
                <b>{c?.title ?? id}</b>
                {c && (
                  <span className="muted">
                    {' '}
                    {c.handle ?? ''} · {compactCount(c.subscribers)} người đăng ký
                  </span>
                )}
                {c === null && <span className="muted"> (không đọc được thông tin kênh)</span>}
              </span>
              <button
                className="link"
                title="Bỏ"
                onClick={() =>
                  void set(
                    'autopilot.competitors',
                    competitors.filter((x) => x !== id),
                  )
                }
              >
                ×
              </button>
            </li>
          );
        })}
        {!competitors.length && <li className="muted">Chưa có đối thủ.</li>}
      </ul>
      <div className="row">
        <input
          data-testid="competitor-input"
          placeholder="URL kênh, @handle hoặc ID (UC…)"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void addCompetitor();
          }}
        />
        <button onClick={() => void addCompetitor()}>Thêm</button>
      </div>

      <h3>Nội dung</h3>
      <label className="field">
        Chủ đề trụ cột{src('autopilot.pillars')}
        <div className="row">
          <input
            placeholder="ví dụ: lịch sử Việt Nam, nhân vật, trận đánh"
            value={pillars}
            onChange={(e) => setPillars(e.target.value)}
          />
          <button onClick={() => void set('autopilot.pillars', parseList(pillars), 'Đã lưu.')}>
            Lưu
          </button>
        </div>
      </label>
      <div className="field">
        Workflow được dùng{src('autopilot.workflows')}
        <span className="muted"> — không chọn = mọi workflow</span>
        <div className="chips">
          {workflows.map((w) => (
            <label key={w.id} className="chip">
              <input
                type="checkbox"
                checked={allowed.includes(w.id)}
                onChange={(e) =>
                  void set(
                    'autopilot.workflows',
                    e.target.checked ? [...allowed, w.id] : allowed.filter((x) => x !== w.id),
                  )
                }
              />
              {w.title}
            </label>
          ))}
        </div>
      </div>
      <label className="field">
        Số video tối đa mỗi ngày{src('autopilot.max_per_day')}
        <input
          type="number"
          min={0}
          max={20}
          value={String(v<number>('autopilot.max_per_day') ?? 1)}
          onChange={(e) => void set('autopilot.max_per_day', Number(e.target.value))}
        />
      </label>

      <h3>Đăng video</h3>
      {/* 071: kết nối tài khoản đăng video của kênh */}
      <ChannelConnections channel={channel} />
      <div className="field">
        Nền tảng{src('publish.platforms')}
        <span className="muted"> — nền tảng nào sẽ được đăng tự động</span>
        <div className="chips">
          {Object.entries(PLATFORM_LABEL).map(([id, label]) => (
            <label key={id} className="chip">
              <input
                type="checkbox"
                checked={platforms.includes(id)}
                onChange={(e) =>
                  void set(
                    'publish.platforms',
                    e.target.checked ? [...platforms, id] : platforms.filter((x) => x !== id),
                  )
                }
              />
              {label}
            </label>
          ))}
        </div>
      </div>
      <label className="field">
        Khung giờ đăng{src('publish.slots')}
        <span className="muted"> — "19:00" mỗi ngày, "sat 09:00" theo thứ, "mon-fri 07:15"</span>
        <div className="row">
          <input value={slots} onChange={(e) => setSlots(e.target.value)} />
          <button onClick={() => void set('publish.slots', parseList(slots), 'Đã lưu.')}>
            Lưu
          </button>
        </div>
      </label>
      <label className="field">
        Múi giờ{src('publish.timezone')}
        <input
          defaultValue={String(v<string>('publish.timezone') ?? '')}
          onBlur={(e) => void set('publish.timezone', e.target.value.trim())}
        />
      </label>
      <label className="field">
        Giờ chờ phản đối trước khi công khai{src('publish.veto_hours')}
        <input
          type="number"
          min={0}
          max={72}
          value={String(v<number>('publish.veto_hours') ?? 2)}
          onChange={(e) => void set('publish.veto_hours', Number(e.target.value))}
        />
      </label>

      {msg && (
        <p className={msg.tone === 'error' ? 'error' : 'success'} role="status">
          {msg.text}
        </p>
      )}
      <button onClick={onClose}>Đóng</button>
    </Surface>
  );
}
