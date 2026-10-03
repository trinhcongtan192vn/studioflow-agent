import type { ProviderRegistry } from '../capability/registry.js';
import type { MusicFindInput } from '../contracts/types.js';
import type { ToolDefinition } from '../gateway/types.js';
import type { JobQueue } from '../jobs/queue.js';
import type { Db } from '../store/db.js';
import type { WriteStore } from '../store/writer.js';
import { findMusic } from './find.js';
import { addTracks, type AddInput } from './library.js';

export interface MusicServices {
  queue: JobQueue;
  providers: ProviderRegistry;
  db?: Db;
  storeFor(dir: string): WriteStore;
}

const range = {
  type: 'object',
  properties: { min: { type: 'number' }, max: { type: 'number' } },
  additionalProperties: false,
};
const FIND_INPUT = {
  type: 'object',
  properties: {
    query: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    bpm: range,
    energy: range,
    min_duration_ms: { type: 'integer', minimum: 0 },
    exclude_ids: { type: 'array', items: { type: 'string', pattern: '^mt_[0-9a-z]{8}$' } },
    limit: { type: 'integer', minimum: 1, maximum: 50 },
  },
  additionalProperties: false,
};

/** Loại job `music.library.add` (engine `audio-analysis`, CPU). */
export function defineMusicJobs(s: MusicServices, appDataDir: string): void {
  s.queue.define('music.library.add', {
    engine: 'audio-analysis',
    idempotent: true,
    run: async (job, ctx) =>
      addTracks(
        { channel: s.storeFor(job.channel_dir!), appDataDir, providers: s.providers, db: s.db },
        job.payload as AddInput,
        {
          signal: ctx.signal,
          progress: ctx.progress,
        },
      ),
  });
}

/** Tool `music.library.add`, `music.find`, `sfx.find` (D8 mục 2). */
export function musicTools(s: MusicServices, appDataDir: string): ToolDefinition[] {
  return [
    {
      name: 'music.library.add',
      description:
        'Nạp nhạc/SFX (file trong uploads/) vào kho kênh hoặc app, phân tích thời lượng/BPM/energy/độ to; trả job → {track_ids, skipped}.',
      returnsJob: true,
      input: {
        type: 'object',
        properties: {
          files: { type: 'array', items: { type: 'string' }, minItems: 1 },
          scope: { enum: ['channel', 'app'] },
          kind: { enum: ['music', 'sfx'] },
          source: { type: 'string' },
          url: { type: 'string' },
          attribution: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          description: { type: 'string' },
        },
        required: ['files', 'scope'],
        additionalProperties: false,
      },
      async handler(input: AddInput, ctx) {
        const v = ctx.session.video_id;
        // đường dẫn tương đối video khi phiên gắn video
        const files = input.files.map((f) =>
          v && !f.startsWith('videos/') ? `videos/${v}/${f}` : f,
        );
        const job = s.queue.enqueue('music.library.add', {
          channel_dir: ctx.store.root,
          ...(v ? { video_id: v } : {}),
          payload: { ...input, files },
        });
        return { job_id: job.id };
      },
    },
    {
      name: 'music.find',
      description:
        'Tìm nhạc trong kho kênh + app: lọc cứng tags/bpm/energy/min_duration_ms, xếp hạng theo query.',
      input: FIND_INPUT,
      handler: async (i: MusicFindInput, ctx) =>
        findMusic({ channel: ctx.store, appDataDir }, i, 'music'),
    },
    {
      name: 'sfx.find',
      description: 'Tìm SFX trong kho kênh + app (như music.find, chỉ kind = sfx).',
      input: FIND_INPUT,
      handler: async (i: MusicFindInput, ctx) =>
        findMusic({ channel: ctx.store, appDataDir }, i, 'sfx'),
    },
  ];
}
