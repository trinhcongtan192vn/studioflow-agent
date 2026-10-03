import { useEffect, useState } from 'react';
import type { StudioflowApi } from '../preload/index';
import { Home } from './Home';
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

  useEffect(() => {
    void window.studioflow.coreVersion().then((v) => setLabel(versionLabel(v)));
    window.studioflow.onCoreStatus((s) => setCoreDown(!s.ok));
    const off = core.on('core.ready', () => setCoreDown(false));
    void core.call('app.status', {}).then((s) => {
      setStatus(s);
      // UI-01: thiếu đăng nhập hoặc còn thành phần chưa tải → onboarding
      if (!s.auth.ok || s.install.missing.length) setOnboarding(true);
    });
    void window.studioflow.boot().then((b) => {
      if (b.open_channel) setChannel(b.open_channel);
    });
    return off;
  }, []);

  return (
    <div className="app">
      {coreDown && <div className="overlay">Đang khởi động lại lõi…</div>}
      {onboarding && status && <Onboarding status={status} onDone={() => setOnboarding(false)} />}
      {channel ? (
        <Workspace channel={channel} onClose={() => setChannel(null)} />
      ) : (
        <Home onOpen={setChannel} />
      )}
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
