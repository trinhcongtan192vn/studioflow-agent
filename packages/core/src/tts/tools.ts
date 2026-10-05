import { existsSync, readdirSync, readFileSync } from 'node:fs';
import type { ProviderRegistry } from '../capability/registry.js';
import { runCapability } from '../capability/run.js';
import { canonicalJson, sha256 } from '../domain/hash.js';
import { newId } from '../domain/ids.js';
import { SfError } from '../errors.js';
import { sessionPath } from '../gateway/session.js';
import type { ToolDefinition } from '../gateway/types.js';
import type { BuilderRegistry } from '../graph/graph.js';
import { startGraphBuild } from '../graph/tools.js';
import type { JobQueue } from '../jobs/queue.js';
import type { Db } from '../store/db.js';
import type { WriteStore } from '../store/writer.js';
import { voiceFile } from './builder.js';
import {
  createDesignedVoice,
  designInstruct,
  DESIGN_ACCENTS,
  DESIGN_AGES,
  DESIGN_GENDERS,
  DESIGN_PITCHES,
  type VoiceDesignAttrs,
} from './design.js';

export interface TtsServices {
  queue: JobQueue;
  builders: BuilderRegistry;
  providers: ProviderRegistry;
  db?: Db;
  storeFor(dir: string): WriteStore;
  /** Cửa sổ gom `graph.build` (019). */
  batchWindowMs?: number;
}

function channelLanguage(store: WriteStore): string {
  return (JSON.parse(readFileSync(store.abs('channel.json'), 'utf8')) as { language: string })
    .language;
}

/** Tạo giọng clone: `voices/<vo>/{voice.pt, ref.wav, profile.json}` (006 FR-008). */
export async function createVoiceProfile(
  s: Pick<TtsServices, 'providers' | 'db'>,
  store: WriteStore,
  input: {
    name: string;
    ref_audio: string;
    language: string;
    ref_text?: string;
    appDataDir?: string;
  },
  opts: { signal?: AbortSignal; progress?: (d: number, t: number) => void } = {},
): Promise<{ voice_id: string; files: string[] }> {
  const voicesDir = store.abs('voices');
  const taken = new Set(existsSync(voicesDir) ? readdirSync(voicesDir) : []);
  const voiceId = newId('vo', taken);
  const adapter = await s.providers.resolve('voice.profile', {
    channelDir: store.root,
    language: input.language,
    appDataDir: input.appDataDir,
  });
  const base = `voices/${voiceId}`;
  const r = await runCapability({
    store,
    db: s.db,
    adapter,
    capability: 'voice.profile',
    input: {
      name: input.name,
      language: input.language,
      ref_audio: input.ref_audio,
      ...(input.ref_text ? { ref_text: input.ref_text } : {}),
    },
    outputs: { voice: `${base}/voice.pt`, ref: `${base}/ref.wav` },
    signal: opts.signal,
    progress: opts.progress,
  });
  const profile = {
    voice_id: voiceId,
    name: input.name,
    language: input.language,
    ref_text: (r.output as { ref_text?: string }).ref_text ?? '',
    provider: adapter.manifest.id,
    created_at: new Date().toISOString(),
  };
  store.write(`${base}/profile.json`, `${JSON.stringify(profile, null, 2)}\n`, {
    by: 'voice.profile',
  });
  return {
    voice_id: voiceId,
    files: ['voice.pt', 'ref.wav', 'profile.json'].map((f) => `${base}/${f}`),
  };
}

/** Một câu TTS ra file (nghe thử, `sf tts say`). */
export async function speak(
  s: Pick<TtsServices, 'providers' | 'db'>,
  store: WriteStore,
  input: {
    voice_id: string;
    text: string;
    emotion?: string;
    language?: string;
    out?: string;
    videoId?: string;
    appDataDir?: string;
  },
  opts: { signal?: AbortSignal } = {},
): Promise<{ file: string; duration_ms: number; from_cache: boolean }> {
  const language = input.language ?? channelLanguage(store);
  const adapter = await s.providers.resolve('tts.synthesize', {
    channelDir: store.root,
    videoId: input.videoId,
    language,
    appDataDir: input.appDataDir,
  });
  const vf = voiceFile(store, input.voice_id);
  const ttsInput = {
    text: input.text,
    language,
    voice_id: input.voice_id,
    ...(input.emotion ? { emotion: input.emotion } : {}),
    ...(vf.file ? { voice_file: vf.file } : {}),
    voice_hash: vf.hash,
  };
  const base = input.videoId ? `videos/${input.videoId}/` : '';
  const out =
    input.out ?? `${base}.sf/preview/tts-${sha256(canonicalJson(ttsInput)).slice(0, 12)}.wav`;
  const r = await runCapability({
    store,
    db: s.db,
    adapter,
    capability: 'tts.synthesize',
    input: ttsInput,
    videoId: input.videoId,
    outputs: { file: out },
    signal: opts.signal,
  });
  return {
    file: base && out.startsWith(base) ? out.slice(base.length) : out,
    duration_ms: (r.output as { duration_ms: number }).duration_ms,
    from_cache: r.from_cache,
  };
}

/** Loại job `voice.profile`, `voice.preview` (engine omnivoice — chạy nối tiếp). */
export function defineTtsJobs(s: TtsServices, appDataDir?: string): void {
  s.queue.define('voice.profile', {
    needsDisk: true,
    engine: 'omnivoice',
    idempotent: true,
    run: async (job, ctx) => {
      const p = job.payload as { name: string; ref_audio: string; language: string };
      return createVoiceProfile(
        s,
        s.storeFor(job.channel_dir!),
        { ...p, appDataDir },
        { signal: ctx.signal, progress: ctx.progress },
      );
    },
  });
  s.queue.define('voice.design', {
    needsDisk: true,
    engine: 'omnivoice',
    idempotent: true,
    run: async (job, ctx) => {
      const p = job.payload as Parameters<typeof createDesignedVoice>[2];
      return createDesignedVoice(
        s,
        s.storeFor(job.channel_dir!),
        { ...p, appDataDir },
        { signal: ctx.signal, progress: ctx.progress },
      );
    },
  });
  s.queue.define('voice.preview', {
    needsDisk: true,
    engine: 'omnivoice',
    idempotent: true,
    run: async (job, ctx) => {
      const p = job.payload as { voice_id: string; text: string; emotion?: string };
      return speak(
        s,
        s.storeFor(job.channel_dir!),
        { ...p, videoId: job.video_id, appDataDir },
        { signal: ctx.signal },
      );
    },
  });
}

export function ttsTools(s: TtsServices): ToolDefinition[] {
  return [
    {
      name: 'tts.synthesize',
      description:
        'Sinh audio cho các line (line_ids hoặc "all") qua build graph; trả job. Chỉ line đổi mới sinh lại.',
      returnsJob: true,
      input: {
        type: 'object',
        properties: {
          line_ids: {
            anyOf: [
              { const: 'all' },
              {
                type: 'array',
                items: { type: 'string', pattern: '^ln_[0-9a-z]{8}$' },
                minItems: 1,
              },
            ],
          },
        },
        required: ['line_ids'],
        additionalProperties: false,
      },
      handler: (input: { line_ids: 'all' | string[] }, ctx) =>
        startGraphBuild(
          s,
          ctx,
          input.line_ids === 'all'
            ? ['audio.line', 'audio_meta']
            : [...input.line_ids.map((l) => `audio.line:${l}`), 'audio_meta'],
          'tts.synthesize',
        ),
    },
    {
      name: 'voice.profile_create',
      description:
        'Clone giọng từ file mẫu 3–10 giây (đường dẫn trong uploads/); trả job → {voice_id}.',
      returnsJob: true,
      input: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1 },
          ref_audio: { type: 'string' },
          language: { enum: ['vi', 'de', 'en'] },
        },
        required: ['name', 'ref_audio', 'language'],
        additionalProperties: false,
      },
      async handler(input: { name: string; ref_audio: string; language: string }, ctx) {
        const sp = sessionPath(ctx.session, input.ref_audio, 'read');
        if (!existsSync(ctx.store.abs(sp.rel)))
          throw new SfError('E_FILE_NOT_FOUND', `${input.ref_audio} does not exist`);
        const job = s.queue.enqueue('voice.profile', {
          channel_dir: ctx.store.root,
          video_id: ctx.session.video_id,
          payload: { name: input.name, ref_audio: sp.rel, language: input.language },
        });
        return { job_id: job.id };
      },
    },
    {
      name: 'voice.design',
      description:
        'Giọng gợi ý khi chưa có file mẫu (033): tạo giọng từ mô tả (giới tính, tuổi, cao độ), sinh câu mẫu rồi clone → voices/<vo>/. Gọi 2–3 lần với mô tả/seed khác nhau để người dùng nghe và chọn; không tự chọn thay. for = "narrator" hoặc ca_… (giọng dành cho ai). accent chỉ dùng cho kênh tiếng Anh. Trả job → {voice_id, name, for, preview, design}.',
      returnsJob: true,
      input: {
        type: 'object',
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 60 },
          gender: { enum: [...DESIGN_GENDERS] },
          age: { enum: [...DESIGN_AGES] },
          pitch: { enum: [...DESIGN_PITCHES] },
          whisper: { type: 'boolean' },
          accent: { enum: [...DESIGN_ACCENTS] },
          for: { type: 'string', pattern: '^(narrator|ca_[0-9a-z]{8})$' },
          sample_text: { type: 'string', minLength: 20, maxLength: 300 },
          seed: { type: 'integer', minimum: 0, maximum: 1000000 },
        },
        required: ['name', 'gender', 'age', 'pitch'],
        additionalProperties: false,
      },
      async handler(
        input: VoiceDesignAttrs & {
          name: string;
          for?: string;
          sample_text?: string;
          seed?: number;
        },
        ctx,
      ) {
        const language = channelLanguage(ctx.store);
        designInstruct(input, language); // kiểm sớm (accent chỉ cho tiếng Anh)
        const job = s.queue.enqueue('voice.design', {
          channel_dir: ctx.store.root,
          video_id: ctx.session.video_id,
          payload: { ...input, language },
        });
        return { job_id: job.id };
      },
    },
    {
      name: 'voice.preview',
      description: 'Nghe thử một giọng với câu bất kỳ; trả job → {file} (trong .sf/preview/).',
      returnsJob: true,
      input: {
        type: 'object',
        properties: {
          voice_id: { type: 'string', pattern: '^vo_[0-9a-z]{8}$' },
          text: { type: 'string', minLength: 1, maxLength: 600 },
          emotion: { type: 'string' },
        },
        required: ['voice_id', 'text'],
        additionalProperties: false,
      },
      async handler(input: { voice_id: string; text: string; emotion?: string }, ctx) {
        const job = s.queue.enqueue('voice.preview', {
          channel_dir: ctx.store.root,
          video_id: ctx.session.video_id,
          payload: input,
        });
        return { job_id: job.id };
      },
    },
  ];
}
