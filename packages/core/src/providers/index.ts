import { createFakeAsrProvider, createHfTranscribeProvider } from '../asr/providers.js';
import type { ProviderRegistry } from '../capability/registry.js';
import { createAudioAnalysisProvider } from '../music/provider.js';
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
  // phân tích nhạc chạy CPU → luôn là provider thật (D12: chỉ LLM/GPU được giả lập)
  const analysis = createAudioAnalysisProvider(opts);
  registry.register(analysis.adapter);
  if (process.env.SF_GPU === '0') {
    registry.register(createFakeTtsProvider());
    registry.register(createFakeAsrProvider());
    return { stop: () => analysis.worker.stop() };
  }
  const omni = createOmniVoiceProvider(opts);
  registry.register(omni.adapter);
  registry.register(createHfTranscribeProvider(opts));
  return {
    stop: async () => void (await Promise.all([omni.worker.stop(), analysis.worker.stop()])),
  };
}

export { createFakeTtsProvider, type TtsAdapterInput, type VoiceAdapterInput } from './fake.js';
export { createOmniVoiceProvider, enginePython, WORKER_SRC } from './omnivoice.js';
export { loadProviderManifest } from './manifest.js';
export { encodeWav, wavDurationMs } from './wav.js';
