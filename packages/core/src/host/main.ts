// Entry tiến trình `core` (Electron utilityProcess, tech-defaults mục 1): `main` gửi
// {type:'init', appDataDir, secrets} kèm MessagePort; JSON-RPC 2.0 renderer ↔ core qua port đó.
import { setHostSecrets } from '../secrets/credman.js';
import type { HostControl, IpcRequest } from '../ipc/schema.js';
import { createMessageSecretStore } from '../secrets/store.js';
import { CoreHost } from './host.js';

interface PortLike {
  on(ev: 'message', fn: (e: { data: unknown }) => void): void;
  postMessage(m: unknown): void;
  start(): void;
}
interface ParentPort {
  on(ev: 'message', fn: (e: { data: unknown; ports: PortLike[] }) => void): void;
  postMessage(m: unknown): void;
}

const parentPort = (process as unknown as { parentPort?: ParentPort }).parentPort;
if (!parentPort) throw new Error('core host must run in an Electron utilityProcess');

let host: CoreHost | undefined;

parentPort.on('message', (e) => {
  const msg = e.data as (
    { type: 'init'; appDataDir?: string; secrets?: Record<string, string> } | HostControl
  ) & { type: string };
  if (msg.type === 'secrets') {
    setHostSecrets((msg as HostControl).secrets);
    return;
  }
  if (msg.type !== 'init' || host) return;
  const init = msg as { appDataDir?: string; secrets?: Record<string, string> };
  setHostSecrets(init.secrets ?? {});
  // 052: app thật chạy Autopilot theo chu kỳ (5 phút); test/CLI tạo CoreHost không bật;
  // `SF_AUTOPILOT=0` tắt (test giao diện chạy app thật không được tự tạo video)
  host = new CoreHost({
    ...(init.appDataDir ? { appDataDir: init.appDataDir } : {}),
    ...(process.env.SF_AUTOPILOT === '0' ? {} : { autopilot: {} }),
    // 055/D5 5.4: bí mật qua `main` (Credential Manager) — core không tự đọc
    secrets: createMessageSecretStore({
      send: (m) => parentPort.postMessage(m),
      subscribe: (fn) => parentPort.on('message', (ev) => fn(ev.data)),
    }),
  });
  const port = e.ports[0]!;
  port.on('message', (m) => {
    const req = m.data as IpcRequest;
    void host!.handle(req).then((res) => port.postMessage(res));
  });
  host.on('event', (method: string, params: unknown) =>
    port.postMessage({ jsonrpc: '2.0', method, params }),
  );
  port.start();
  parentPort.postMessage({ type: 'ready' });
});

process.on('exit', () => host?.close());
