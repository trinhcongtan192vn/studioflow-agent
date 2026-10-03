import { useEffect, useState } from 'react';
import { core } from './rpc';

/** UI-02 Trang chủ: kênh gần đây, mở thư mục kênh, tạo kênh mới. */
export function Home({ onOpen }: { onOpen: (dir: string) => void }) {
  const [recent, setRecent] = useState<{ path: string; opened_at: string }[]>([]);
  const [error, setError] = useState('');
  const [name, setName] = useState('');

  useEffect(() => {
    void core.call('channel.list_recent', {}).then((r) => setRecent(r.channels));
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

  return (
    <main className="home">
      <h1>StudioFlow</h1>
      <section>
        <h2>Kênh gần đây</h2>
        <ul className="list" data-testid="recent-channels">
          {recent.map((c) => (
            <li key={c.path}>
              <button className="link" onClick={() => void open(c.path)}>
                {c.path}
              </button>
            </li>
          ))}
          {!recent.length && <li className="muted">Chưa có kênh nào.</li>}
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
    </main>
  );
}
