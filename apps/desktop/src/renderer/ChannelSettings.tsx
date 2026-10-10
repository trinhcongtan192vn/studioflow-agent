import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AdvancedPanel } from './AdvancedPanel';
import { DesignSystemPanel } from './DesignSystemPanel';
import { HostPanel } from './HostPanel';
import { ChannelConnections } from './Connections';
import { Icon } from './Icon';
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
type Info = Awaited<ReturnType<typeof core.call<'channel.info.get'>>>;
type Lang = Info['language'];

/** 082: ngôn ngữ kênh hỗ trợ (D3 `Lang`). */
export const LANG_LABEL: Record<Lang, string> = {
  vi: 'Tiếng Việt',
  en: 'English',
  de: 'Deutsch',
};

const SECTIONS = [
  { id: 'info', label: 'Thông tin kênh' },
  { id: 'mode', label: 'Chế độ' },
  { id: 'content', label: 'Nội dung' },
  { id: 'design', label: 'Design system' },
  { id: 'host', label: 'Nhân vật dẫn chuyện' },
  { id: 'advanced', label: 'Nâng cao' },
  { id: 'competitors', label: 'Kênh đối thủ' },
  { id: 'publish', label: 'Đăng video' },
] as const;

/**
 * Cài đặt kênh (047, FR-AP-01/02; 082 bố cục mục lục): thông tin kênh (tên, ngôn ngữ mặc định), Autopilot ↔
 * Manual, nội dung, đối thủ, đăng video.
 */
export function ChannelSettings({ channel, onClose }: { channel: string; onClose: () => void }) {
  const [s, setS] = useState<Settings>();
  const [info, setInfo] = useState<Info>();
  const [name, setName] = useState('');
  const [workflows, setWorkflows] = useState<{ id: string; title: string }[]>([]);
  const [cards, setCards] = useState<Record<string, Card | null>>({});
  const [adding, setAdding] = useState('');
  const [msg, setMsg] = useState<{ tone: 'error' | 'success'; text: string }>();
  const [active, setActive] = useState<string>('info');
  const body = useRef<HTMLDivElement>(null);
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
  const loadInfo = () =>
    void core
      .call('channel.info.get', { channel })
      .then((i) => {
        setInfo(i);
        setName(i.name);
      })
      .catch(() => setInfo(undefined));
  useEffect(() => {
    loadInfo();
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
  const setInfoField = async (patch: { name?: string; language?: Lang }, ok: string) => {
    try {
      await core.call('channel.info.set', { channel, ...patch });
      loadInfo();
      setMsg({ tone: 'success', text: ok });
    } catch (e) {
      setMsg({ tone: 'error', text: (e as Error).message });
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
    <span className="src-tag" title="Giá trị lấy từ">
      {sourceLabel(s[k]?.source ?? 'default')}
    </span>
  );
  const go = (id: string) => {
    setActive(id);
    body.current
      ?.querySelector(`#chs-${id}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const section = (id: (typeof SECTIONS)[number]['id'], children: ReactNode, hint?: string) => (
    <section id={`chs-${id}`} className="set-section">
      <h3>{SECTIONS.find((x) => x.id === id)!.label}</h3>
      {hint && <p className="muted">{hint}</p>}
      {children}
    </section>
  );

  return (
    <Surface
      label="Cài đặt kênh"
      className="channel-settings"
      testId="channel-settings"
      onClose={onClose}
    >
      <div className="set-top">
        <div>
          <h2>{info?.name ?? 'Cài đặt kênh'}</h2>
          <span className={`badge ${on ? 'on' : 'fmt'}`}>{on ? 'Autopilot' : 'Manual'}</span>{' '}
          {info && <span className="badge fmt">{LANG_LABEL[info.language]}</span>}
        </div>
        <button onClick={onClose}>Đóng</button>
      </div>
      {msg && (
        <p className={msg.tone === 'error' ? 'error' : 'success'} role="status">
          {msg.text}
        </p>
      )}
      <div className="set-layout">
        <nav className="set-nav" aria-label="Mục cài đặt kênh">
          {SECTIONS.map((x) => (
            <button key={x.id} className={active === x.id ? 'active' : ''} onClick={() => go(x.id)}>
              {x.label}
            </button>
          ))}
        </nav>
        <div className="set-body" ref={body}>
          {section(
            'info',
            info ? (
              <>
                <label className="field">
                  Tên kênh
                  <span className="row">
                    <input value={name} onChange={(e) => setName(e.target.value)} />
                    <button
                      disabled={!name.trim() || name.trim() === info.name}
                      onClick={() => void setInfoField({ name }, 'Đã đổi tên kênh.')}
                    >
                      Lưu
                    </button>
                  </span>
                </label>
                <label className="field">
                  Ngôn ngữ mặc định
                  <select
                    data-testid="channel-language"
                    value={info.language}
                    onChange={(e) =>
                      void setInfoField(
                        { language: e.target.value as Lang },
                        `Đã đặt ngôn ngữ mặc định: ${LANG_LABEL[e.target.value as Lang]}. Video tạo sau sẽ dùng ngôn ngữ này.`,
                      )
                    }
                  >
                    {(Object.keys(LANG_LABEL) as Lang[]).map((l) => (
                      <option key={l} value={l}>
                        {LANG_LABEL[l]}
                      </option>
                    ))}
                  </select>
                  <span className="muted">
                    Ngôn ngữ lời đọc, phụ đề và kịch bản của video mới. Video đã có giữ ngôn ngữ của
                    nó.
                  </span>
                </label>
                <dl className="kv about">
                  <div>
                    <dt>Thư mục</dt>
                    <dd>
                      <button
                        className="link"
                        onClick={() => void window.studioflow.openPath(info.path)}
                      >
                        {info.path}
                      </button>
                    </dd>
                  </div>
                  <div>
                    <dt>Video</dt>
                    <dd>{info.videos}</dd>
                  </div>
                </dl>
              </>
            ) : (
              <p className="muted">Đang tải…</p>
            ),
          )}

          {section(
            'mode',
            <div className="mode-cards" role="radiogroup" aria-label="Chế độ kênh">
              <label className={`mode-card${!on ? ' active' : ''}`}>
                <input
                  type="radio"
                  name="mode"
                  checked={!on}
                  onChange={() => void set('autopilot.enabled', false, 'Đã chuyển sang Manual.')}
                />
                <span>
                  <b>Manual</b>
                  <span className="muted">Bạn ra lệnh, agent làm từng video cùng bạn.</span>
                </span>
              </label>
              <label className={`mode-card${on ? ' active' : ''}`}>
                <input
                  type="radio"
                  name="mode"
                  data-testid="mode-autopilot"
                  checked={on}
                  onChange={() => void set('autopilot.enabled', true, 'Đã bật Autopilot cho kênh.')}
                />
                <span>
                  <b>
                    <Icon name="sparkles" size={14} /> Autopilot
                  </b>
                  <span className="muted">
                    Mỗi ngày tự tìm chủ đề, lên kế hoạch, làm video và đăng theo lịch.
                  </span>
                </span>
              </label>
            </div>,
          )}

          {section(
            'content',
            <>
              <label className="field">
                <span>Chủ đề trụ cột {src('autopilot.pillars')}</span>
                <span className="row">
                  <input
                    placeholder="ví dụ: lịch sử Việt Nam, nhân vật, trận đánh"
                    value={pillars}
                    onChange={(e) => setPillars(e.target.value)}
                  />
                  <button
                    onClick={() => void set('autopilot.pillars', parseList(pillars), 'Đã lưu.')}
                  >
                    Lưu
                  </button>
                </span>
              </label>
              <div className="field">
                <span>
                  Workflow được dùng {src('autopilot.workflows')}{' '}
                  <span className="muted">— không chọn = mọi workflow</span>
                </span>
                <div className="chips">
                  {workflows.map((w) => (
                    <label key={w.id} className={`chip${allowed.includes(w.id) ? ' on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={allowed.includes(w.id)}
                        onChange={(e) =>
                          void set(
                            'autopilot.workflows',
                            e.target.checked
                              ? [...allowed, w.id]
                              : allowed.filter((x) => x !== w.id),
                          )
                        }
                      />
                      {w.title}
                    </label>
                  ))}
                </div>
              </div>
              <label className="field">
                <span>Số video tối đa mỗi ngày {src('autopilot.max_per_day')}</span>
                <input
                  type="number"
                  min={0}
                  max={20}
                  value={String(v<number>('autopilot.max_per_day') ?? 1)}
                  onChange={(e) => void set('autopilot.max_per_day', Number(e.target.value))}
                />
              </label>
            </>,
            'Autopilot chọn chủ đề trong các trụ cột này và chỉ dùng các workflow được chọn.',
          )}

          {section(
            'design',
            <DesignSystemPanel channel={channel} />,
            'Mọi video của kênh theo design system này: màu và chữ của khung hình, phong cách ảnh (khóa cho mọi ảnh), layout và nhịp ưu tiên, nhạc.',
          )}

          {section(
            'host',
            <HostPanel channel={channel} />,
            'Ảnh nhân vật của kênh (png, jpg, webp, jfif) làm người dẫn xuất hiện trong video. Nhân vật khác trong câu chuyện (vd. nhân vật lịch sử) được vẽ theo phong cách tạo hình của ảnh này, giữ đặc trưng riêng của họ.',
          )}

          {section(
            'advanced',
            <AdvancedPanel channel={channel} />,
            'Mặc định tắt hết để video rẻ và ít lỗi. Bật ở đây áp dụng cho mọi video của kênh; từng video có thể đặt riêng trong tab Tiến độ.',
          )}

          {section(
            'competitors',
            <>
              <ul className="competitor-list" data-testid="competitors">
                {competitors.map((id) => {
                  const c = cards[id];
                  return (
                    <li key={id}>
                      {c?.thumbnail ? (
                        <img src={c.thumbnail} alt="" width={36} height={36} />
                      ) : (
                        <span className="avatar">{(c?.title ?? id).slice(0, 1)}</span>
                      )}
                      <span className="grow">
                        <b>{c?.title ?? id}</b>
                        <span className="muted">
                          {c
                            ? `${c.handle ?? ''} · ${compactCount(c.subscribers)} người đăng ký`
                            : c === null
                              ? 'không đọc được thông tin kênh'
                              : 'đang tải…'}
                        </span>
                      </span>
                      <button
                        className="ghost icon-only"
                        title="Bỏ đối thủ"
                        aria-label={`Bỏ ${c?.title ?? id}`}
                        onClick={() =>
                          void set(
                            'autopilot.competitors',
                            competitors.filter((x) => x !== id),
                          )
                        }
                      >
                        <Icon name="x" size={14} />
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
                <button onClick={() => void addCompetitor()}>
                  <Icon name="plus" /> Thêm
                </button>
              </div>
            </>,
            'Autopilot theo dõi video mới và video nổi bật của các kênh này để tìm chủ đề.',
          )}

          {section(
            'publish',
            <>
              {/* 071: kết nối tài khoản đăng video của kênh */}
              <ChannelConnections channel={channel} />
              <label className="field inline" data-testid="ai-disclosure">
                <input
                  type="checkbox"
                  checked={v<boolean>('publish.ai_disclosure') === true}
                  onChange={(e) => void set('publish.ai_disclosure', e.target.checked)}
                />
                <span>
                  Khai báo &quot;nội dung do AI tạo&quot; khi đăng YouTube{' '}
                  {src('publish.ai_disclosure')}{' '}
                  <span className="muted">
                    — chỉ bật khi video có cảnh trông như thật mà không có thật, hoặc người thật
                    nói/làm điều họ không làm (YouTube yêu cầu); video minh họa/hoạt hình để tắt
                  </span>
                </span>
              </label>
              <div className="field">
                <span>
                  Nền tảng {src('publish.platforms')}{' '}
                  <span className="muted">— nền tảng nào sẽ được đăng tự động</span>
                </span>
                <div className="chips">
                  {Object.entries(PLATFORM_LABEL).map(([id, label]) => (
                    <label key={id} className={`chip${platforms.includes(id) ? ' on' : ''}`}>
                      <input
                        type="checkbox"
                        checked={platforms.includes(id)}
                        onChange={(e) =>
                          void set(
                            'publish.platforms',
                            e.target.checked
                              ? [...platforms, id]
                              : platforms.filter((x) => x !== id),
                          )
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
              <label className="field">
                <span>
                  Khung giờ đăng {src('publish.slots')}{' '}
                  <span className="muted">
                    — "19:00" mỗi ngày, "sat 09:00" theo thứ, "mon-fri 07:15"
                  </span>
                </span>
                <span className="row">
                  <input value={slots} onChange={(e) => setSlots(e.target.value)} />
                  <button onClick={() => void set('publish.slots', parseList(slots), 'Đã lưu.')}>
                    Lưu
                  </button>
                </span>
              </label>
              <label className="field">
                <span>Múi giờ {src('publish.timezone')}</span>
                <input
                  defaultValue={String(v<string>('publish.timezone') ?? '')}
                  onBlur={(e) => void set('publish.timezone', e.target.value.trim())}
                />
              </label>
              <label className="field">
                <span>Giờ chờ phản đối trước khi công khai {src('publish.veto_hours')}</span>
                <input
                  type="number"
                  min={0}
                  max={72}
                  value={String(v<number>('publish.veto_hours') ?? 2)}
                  onChange={(e) => void set('publish.veto_hours', Number(e.target.value))}
                />
              </label>
            </>,
          )}
        </div>
      </div>
    </Surface>
  );
}
