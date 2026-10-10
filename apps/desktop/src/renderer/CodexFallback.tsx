import { useEffect, useState } from 'react';
import { core } from './rpc';

/** 095: subscription-only fallback, independent of API-key settings. */
export function CodexFallback() {
  const [enabled, setEnabled] = useState(true);
  const [model, setModel] = useState('');
  const [command, setCommand] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void core.call('settings.get', {}).then((s) => {
      const c = (s as { config: Record<string, unknown> }).config;
      setEnabled(c['agent.fallback.enabled'] !== false);
      setModel(String(c['agent.fallback.model'] ?? ''));
      setCommand(String(c['agent.fallback.command'] ?? ''));
    });
  }, []);
  const save = async () => {
    await core.call('settings.set', { key: 'agent.fallback.enabled', value: enabled });
    await core.call('settings.set', { key: 'agent.fallback.model', value: model.trim() });
    await core.call('settings.set', { key: 'agent.fallback.command', value: command.trim() });
  };
  const act = async (action: 'save' | 'login' | 'status') => {
    setBusy(true);
    try {
      await save();
      if (action === 'login') {
        const r = await core.call('codex.login', {});
        if (!(await window.studioflow.openExternal(r.auth_url)))
          throw new Error('Không mở được trang đăng nhập.');
        setStatus('Hoàn tất đăng nhập ChatGPT trong trình duyệt, rồi bấm Kiểm tra kết nối.');
      } else if (action === 'status') {
        const r = await core.call('codex.status', {});
        setStatus(
          r.ok ? `Đã kết nối gói ChatGPT (${r.detail ?? ''}).` : (r.detail ?? 'Chưa đăng nhập.'),
        );
      } else setStatus('Đã lưu cấu hình fallback.');
    } catch (e) {
      setStatus((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section data-testid="codex-fallback">
      <h3>Dự phòng khi Claude hết hạn mức</h3>
      <label className="field">
        <span>
          <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />{' '}
          Tự chuyển sang Codex bằng gói ChatGPT
        </span>
      </label>
      <p className="muted">
        Dùng hạn mức Codex trong gói ChatGPT đã đăng nhập. Không dùng API key, không tự mua thêm
        credit. Khi cả hai hết hạn mức, công việc sẽ dừng chờ.
      </p>
      <label className="field">
        Model Codex
        <input
          value={model}
          placeholder="Để trống = model mặc định của Codex"
          onChange={(e) => setModel(e.target.value)}
        />
      </label>
      <label className="field">
        Đường dẫn Codex CLI
        <input
          value={command}
          placeholder="Để trống = tự tìm trong PATH / VS Code; hoặc đường dẫn codex.exe"
          onChange={(e) => setCommand(e.target.value)}
        />
      </label>
      <p className="muted">
        Cần cài Codex CLI có hỗ trợ app-server. Đăng nhập riêng cho StudioFlow một lần; app giữ
        phiên đăng nhập cho các lần mở sau.
      </p>
      <div className="row">
        <button disabled={busy} onClick={() => void act('login')}>
          Đăng nhập ChatGPT
        </button>
        <button disabled={busy} onClick={() => void act('status')}>
          Kiểm tra kết nối
        </button>
        <button disabled={busy} onClick={() => void act('save')}>
          Lưu fallback
        </button>
      </div>
      {status && <p role="status">{status}</p>}
    </section>
  );
}
