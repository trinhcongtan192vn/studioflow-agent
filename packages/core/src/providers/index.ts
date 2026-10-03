import type { ProviderRegistry } from '../capability/registry.js';
import { createFakeTtsProvider } from './fake.js';
import { createOmniVoiceProvider } from './omnivoice.js';

/**
 * Đăng ký provider mặc định (D4 mục 4.3). `SF_GPU=0` (CI, D12): chỉ provider giả; ngược lại
 * provider thật (health báo không khả dụng nếu chưa cài môi trường engine).
 */
export function registerDefaultProviders(
  registry: ProviderRegistry,
  opts: { appDataDir?: string } = {},
): { stop(): Promise<void> } {
  if (process.env.SF_GPU === '0') {
    registry.register(createFakeTtsProvider());
    return { stop: async () => {} };
  }
  const omni = createOmniVoiceProvider(opts);
  registry.register(omni.adapter);
  return { stop: () => omni.worker.stop() };
}

export { createFakeTtsProvider, type TtsAdapterInput, type VoiceAdapterInput } from './fake.js';
export { createOmniVoiceProvider, enginePython, WORKER_SRC } from './omnivoice.js';
export { loadProviderManifest } from './manifest.js';
export { encodeWav, wavDurationMs } from './wav.js';
