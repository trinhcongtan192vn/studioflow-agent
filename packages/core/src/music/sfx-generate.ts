import path from 'node:path';
import type { ProviderRegistry } from '../capability/registry.js';
import { getGpuScheduler } from '../capability/run.js';
import type { ComfyServer } from '../comfy/server.js';
import { SfError } from '../errors.js';
import { createScratchDir, writeOutsideProject } from '../store/scratch.js';
import type { Db } from '../store/db.js';
import type { WriteStore } from '../store/writer.js';
import { addTracks } from './library.js';

/** Âm nền kéo dài (gió, mưa, sóng, đám đông…) dài hơn tiếng động ngắn. */
const AMBIENT =
  /\b(wind|rain|storm|waves?|ocean|sea|river|stream|crowd|ambien\w*|forest|jungle|traffic|city|fire|crackling|hum|drone|room tone|birds?)\b/i;

export const SFX_CHECKPOINT = 'stable-audio-open-1.0.safetensors';
export const SFX_TEXT_ENCODER = 't5-base.safetensors';

/** Thời lượng (giây) theo loại âm: tiếng động ngắn 4 s, âm nền 8 s. */
export function sfxSeconds(query: string): number {
  return AMBIENT.test(query) ? 8 : 4;
}

/** Workflow API của ComfyUI cho Stable Audio Open 1.0 (theo mẫu `audio_stable_audio_example` của Comfy-Org). */
export function stableAudioWorkflow(prompt: string, seconds: number, seed: number) {
  return {
    '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: SFX_CHECKPOINT } },
    '2': {
      class_type: 'CLIPLoader',
      inputs: { clip_name: SFX_TEXT_ENCODER, type: 'stable_audio', device: 'default' },
    },
    '3': { class_type: 'CLIPTextEncode', inputs: { clip: ['2', 0], text: prompt } },
    '4': {
      class_type: 'CLIPTextEncode',
      inputs: { clip: ['2', 0], text: 'music, melody, speech, voice, low quality, distorted' },
    },
    '5': { class_type: 'EmptyLatentAudio', inputs: { seconds, batch_size: 1 } },
    '6': {
      class_type: 'KSampler',
      inputs: {
        model: ['1', 0],
        positive: ['3', 0],
        negative: ['4', 0],
        latent_image: ['5', 0],
        seed,
        steps: 50,
        cfg: 4.98,
        sampler_name: 'dpmpp_3m_sde_gpu',
        scheduler: 'exponential',
        denoise: 1,
      },
    },
    '7': { class_type: 'VAEDecodeAudio', inputs: { samples: ['6', 0], vae: ['1', 2] } },
    '8': { class_type: 'SaveAudio', inputs: { audio: ['7', 0], filename_prefix: 'sf_sfx' } },
  };
}

const seedOf = (s: string) => {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h % 2147483647;
};

/**
 * Tạo một hiệu ứng âm thanh bằng Stable Audio Open trong ComfyUI của app (2026-10-10, Tan: kho trước, thiếu thì
 * AI tạo) rồi nạp vào **kho SFX của app** (dùng chung mọi kênh; thẻ = từ trong mô tả) → ID bài.
 */
export async function generateSfx(
  d: {
    server: ComfyServer;
    channel: WriteStore;
    appDataDir: string;
    providers: ProviderRegistry;
    db?: Db;
  },
  query: string,
  signal?: AbortSignal,
): Promise<string> {
  const lease = await getGpuScheduler()?.acquire('comfyui', signal);
  const scratch = createScratchDir('sf-sfx-');
  try {
    const c = await d.server.ensure();
    const id = await c.submit(
      stableAudioWorkflow(
        `${query}, sound effect, clean recording, no music`,
        sfxSeconds(query),
        seedOf(query),
      ) as never,
    );
    const out = await c.wait(id, { ...(signal ? { signal } : {}) });
    const ref = out.images[0];
    if (!ref) throw new SfError('E_PROVIDER_FAILED', 'Stable Audio returned no audio');
    const file = path.join(
      scratch.dir,
      `${query.replace(/[^\w-]+/g, '_').slice(0, 60)}${path.extname(ref.filename) || '.flac'}`,
    );
    writeOutsideProject(file, await c.view(ref));
    const r = await addTracks(
      {
        channel: d.channel,
        appDataDir: d.appDataDir,
        providers: d.providers,
        ...(d.db ? { db: d.db } : {}),
      },
      {
        files: [],
        disk_files: [{ path: file }],
        scope: 'app',
        kind: 'sfx',
        source: 'Stable Audio Open (AI)',
        description: query,
        tags: [
          ...new Set(
            query
              .toLowerCase()
              .split(/[^\p{L}\p{N}]+/u)
              .filter((w) => w.length > 2),
          ),
          'ai-generated',
        ],
      },
      { ...(signal ? { signal } : {}) },
    );
    const track = r.track_ids[0];
    if (!track) throw new SfError('E_PROVIDER_FAILED', r.skipped[0]?.reason ?? 'SFX not added');
    return track;
  } finally {
    scratch.cleanup();
    lease?.release();
  }
}
