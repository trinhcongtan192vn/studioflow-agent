import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ProviderAdapter, ProviderManifest } from '../src/index.js';

export function manifest(
  over: Partial<ProviderManifest> & { id: string; capabilities: string[] },
): ProviderManifest {
  return {
    version: '1.0.0',
    contract_versions: Object.fromEntries(over.capabilities.map((c) => [c, '1'])),
    runtime: 'node',
    resource: 'cpu',
    install_profile: 'minimal',
    cost: { kind: 'free' },
    health: { method: 'health', timeout_ms: 1000 },
    app_api: '>=0.1 <2.0',
    ...over,
  };
}

/** Adapter TTS giả: ghi "wav" giả vào workdir, đếm số lần chạy. */
export function fakeTts(
  id = 'tts.test',
  opts: { healthy?: boolean; languages?: ('vi' | 'de' | 'en')[] } = {},
) {
  const state = { calls: 0 };
  const adapter: ProviderAdapter<
    { text: string; voice_id: string; language: string },
    { file: string; duration_ms: number; sample_rate: 48000 }
  > = {
    manifest: manifest({
      id,
      capabilities: ['tts.synthesize'],
      languages: opts.languages ?? ['vi', 'de', 'en'],
    }),
    health: async () => ({ ok: opts.healthy ?? true }),
    cacheKeyParts: (i) => ({ text: i.text, voice: i.voice_id }),
    run: async (input, ctx) => {
      state.calls++;
      writeFileSync(path.join(ctx.workdir, 'out.wav'), `RIFF:${input.text}`);
      ctx.progress(1, 1);
      return { file: 'out.wav', duration_ms: input.text.length * 60, sample_rate: 48000 };
    },
  };
  return { adapter, state };
}
