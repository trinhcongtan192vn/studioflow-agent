import { createGateway, type Gateway, type SessionContext } from '../src/index.js';
import { copyChannel, fixtureAppData, fixtureVideoId } from './domain-helpers.js';

export interface GatewayFixture {
  dir: string;
  gw: Gateway;
  session(over?: Partial<SessionContext>): SessionContext;
  cleanup(): void;
}

/** Kênh mẫu sao chép + Gateway; mọi yêu cầu xác nhận bị từ chối trừ khi test tự xử lý. */
export function gatewayFixture(opts: { permissionTimeoutMs?: number } = {}): GatewayFixture {
  const c = copyChannel();
  const gw = createGateway({
    appDataDir: fixtureAppData,
    permissionTimeoutMs: opts.permissionTimeoutMs ?? 2000,
  });
  return {
    dir: c.dir,
    gw,
    session: (over = {}) => ({
      session_id: 'ss_test0001',
      kind: 'main',
      channel_dir: c.dir,
      video_id: fixtureVideoId,
      ...over,
    }),
    cleanup: c.cleanup,
  };
}
