import { useEffect, useState } from 'react';
import type { StudioflowApi } from '../preload/index';
import { activityLines } from './close-format';
import { closeAction, desktopState } from './autopilot-view';
import { Onboarding } from './Onboarding';
import { core } from './rpc';
import { versionLabel } from './version-label';
import { Workspace } from './Workspace';

declare global {
  interface Window {
    studioflow: StudioflowApi;
  }
}

type Status = Awaited<ReturnType<typeof core.call<'app.status'>>>;

export function App() {
  const [label, setLabel] = useState('…');
  const [status, setStatus] = useState<Status>();
  const [channel, setChannel] = useState<string | null>(null);
  const [coreDown, setCoreDown] = useState(false);
  const [onboarding, setOnboarding] = useState(false);
  // 045: đóng app khi còn việc chạy dở → hỏi xác nhận
  const [closing, setClosing] = useState<string[] | null>(null);

  useEffect(() => {
    void window.studioflow.coreVersion().then((v) => setLabel(versionLabel(v)));
    window.studioflow.onCoreStatus((s) => setCoreDown(!s.ok));
    const off = core.on('core.ready', () => setCoreDown(false));
    void core.call('app.status', {}).then((s) => {
      setStatus(s);
      // UI-01: thiếu đăng nhập hoặc còn thành phần chưa tải → onboarding
      if (!s.auth.ok || s.install.missing.length) setOnboarding(true);
    });
    // 052: trạng thái Autopilot → `main` (khay hệ thống, chống ngủ máy); lệnh từ menu khay
    const background = { on: false };
    const syncAutopilot = async () => {
      try {
        const [status, managed, settings] = await Promise.all([
          core.call('autopilot.status', {}),
          core.call('channels.managed', {}),
          core.call('settings.get', {}) as Promise<{ config: Record<string, unknown> }>,
        ]);
        const st = desktopState(status, {
          anyAutopilot: managed.channels.some((c) => c.autopilot),
          background: settings.config['autopilot.background'] !== false,
        });
        background.on = st.background;
        window.studioflow.setAutopilotState(st);
      } catch {
        /* lõi chưa sẵn sàng → lần cập nhật sau */
      }
    };
    void syncAutopilot();
    const offAp = core.on('autopilot.updated', () => void syncAutopilot());
    const apTimer = window.setInterval(() => void syncAutopilot(), 60_000);
    window.studioflow.onTrayAction((a) => {
      void core
        .call(a === 'pause' ? 'autopilot.pause' : 'autopilot.resume', {})
        .then(() => syncAutopilot());
    });
    window.studioflow.onCloseRequest(({ quit }) => {
      // chạy nền (có kênh Autopilot): nút đóng chỉ ẩn xuống khay
      if (closeAction({ quit, background: background.on }) === 'hide')
        return void window.studioflow.closeReply('hide');
      void Promise.race([
        core.call('app.activity', {}).then(activityLines),
        new Promise<string[]>((r) => setTimeout(() => r([]), 2000)),
      ]).then(
        (lines) => {
          if (!lines.length) return window.studioflow.closeReply('close');
          setClosing(lines);
          return window.studioflow.closeReply('asking');
        },
        () => window.studioflow.closeReply('close'),
      );
    });
    // 048: mở thẳng giao diện chính với kênh mở sẵn (SF_OPEN_CHANNEL) hoặc kênh dùng gần nhất
    void window.studioflow.boot().then(async (b) => {
      const recent = b.open_channel
        ? [b.open_channel]
        : (await core.call('channel.list_recent', {}).catch(() => ({ channels: [] }))).channels.map(
            (c) => c.path,
          );
      for (const dir of recent) {
        try {
          // ghi kênh gần đây + kênh quản lý (047)
          await core.call('channel.open', { channel: dir });
          setChannel(dir);
          return;
        } catch {
          /* thư mục không còn → thử kênh trước đó */
        }
      }
    });
    return () => {
      off();
      offAp();
      window.clearInterval(apTimer);
    };
  }, []);

  return (
    <div className="app">
      {coreDown && <div className="overlay">Đang khởi động lại lõi…</div>}
      {onboarding && status && <Onboarding status={status} onDone={() => setOnboarding(false)} />}
      {closing && (
        <div
          className="modal"
          role="alertdialog"
          aria-label="Đóng StudioFlow"
          data-testid="close-guard"
        >
          <div className="card">
            <h3>Còn việc đang chạy dở</h3>
            <ul>
              {closing.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            <p className="muted">
              Đóng bây giờ thì việc đang chạy dừng giữa chừng; mở lại app có thể cần chạy lại bước
              đó.
            </p>
            <div className="row">
              <button
                className="primary"
                onClick={() => {
                  setClosing(null);
                  void window.studioflow.closeReply('stay');
                }}
              >
                Ở lại
              </button>
              <button
                data-testid="close-anyway"
                onClick={() => void window.studioflow.closeReply('close')}
              >
                Vẫn đóng app
              </button>
            </div>
          </div>
        </div>
      )}
      <Workspace channel={channel} onSwitch={setChannel} />
      <footer className="statusbar">
        <span data-testid="core-version">{label}</span>
        <span>
          {status
            ? status.auth.ok
              ? `Claude: ${status.auth.method}`
              : 'Chưa đăng nhập Claude'
            : '…'}
        </span>
        <span>
          {status && status.install.missing.length
            ? `Thiếu: ${status.install.missing.join(', ')}`
            : ''}
        </span>
      </footer>
    </div>
  );
}
