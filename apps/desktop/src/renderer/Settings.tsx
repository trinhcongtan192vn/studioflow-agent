import { useEffect, useState } from 'react';
import { core } from './rpc';

const LABEL: Record<string, string> = {
  openai: 'OpenAI',
  deepseek: 'DeepSeek',
  anthropic: 'Anthropic (dự phòng)',
};

/** UI-09 Cài đặt (M1): khóa API (chỉ 4 ký tự cuối, lưu Credential Manager ở `main`), model viết. */
export function Settings({ onClose }: { onClose: () => void }) {
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
        <button onClick={onClose}>Đóng</button>
      </div>
    </div>
  );
}
