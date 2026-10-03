import { SfError } from '../errors.js';
import type { ToolDefinition } from '../gateway/types.js';
import type { BuilderRegistry } from '../graph/graph.js';
import type { JobQueue } from '../jobs/queue.js';
import type { WriteStore } from '../store/writer.js';
import { acceptLines, alignVideo } from './regen.js';

export interface AsrServices {
  queue: JobQueue;
  builders: BuilderRegistry;
  storeFor(dir: string): WriteStore;
}

const LINE_IDS = {
  anyOf: [
    { const: 'all' },
    { type: 'array', items: { type: 'string', pattern: '^ln_[0-9a-z]{8}$' }, minItems: 1 },
  ],
};

/** Loại job `asr.align` (engine GPU `asr`; TTS sinh lại chạy trong cùng job). */
export function defineAsrJobs(s: AsrServices, appDataDir?: string): void {
  s.queue.define('asr.align', {
    idempotent: true,
    async run(job, ctx) {
      const p = job.payload as { line_ids: 'all' | string[] };
      const r = await alignVideo(
        { store: s.storeFor(job.channel_dir!), builders: s.builders, appDataDir },
        job.video_id!,
        {
          ...(p.line_ids === 'all' ? {} : { lineIds: p.line_ids }),
          signal: ctx.signal,
          progress: ctx.progress,
        },
      );
      if (r.status !== 'succeeded') ctx.outcome(r.status);
      return r;
    },
  });
}

export function asrTools(s: AsrServices): ToolDefinition[] {
  return [
    {
      name: 'asr.align',
      description:
        'Nghe lại audio các line bằng ASR: cập nhật words/asr_wer/asr_flag trong audio_meta.json và caption_groups.json; line đọc sai tự sinh lại tối đa asr.max_regen lần. Trả job.',
      returnsJob: true,
      input: {
        type: 'object',
        properties: { line_ids: LINE_IDS },
        required: ['line_ids'],
        additionalProperties: false,
      },
      async handler(input: { line_ids: 'all' | string[] }, ctx) {
        if (!ctx.session.video_id)
          throw new SfError('E_SCHEMA_INVALID', 'asr.align needs a video session');
        const job = s.queue.enqueue('asr.align', {
          channel_dir: ctx.store.root,
          video_id: ctx.session.video_id,
          payload: { line_ids: input.line_ids },
        });
        return { job_id: job.id };
      },
    },
    {
      name: 'asr.accept',
      description: 'Chấp nhận audio hiện tại của các line bị ASR báo lệch (asr_flag = accepted).',
      input: {
        type: 'object',
        properties: {
          line_ids: {
            type: 'array',
            items: { type: 'string', pattern: '^ln_[0-9a-z]{8}$' },
            minItems: 1,
          },
        },
        required: ['line_ids'],
        additionalProperties: false,
      },
      async handler(input: { line_ids: string[] }, ctx) {
        if (!ctx.session.video_id)
          throw new SfError('E_SCHEMA_INVALID', 'asr.accept needs a video session');
        return acceptLines(
          { store: ctx.store, builders: s.builders, appDataDir: ctx.appDataDir },
          ctx.session.video_id,
          input.line_ids,
        );
      },
    },
  ];
}
