import { SfError } from '../errors.js';
import type { ToolDefinition } from '../gateway/types.js';
import type { JobQueue } from '../jobs/queue.js';
import type { WriteStore } from '../store/writer.js';
import type { FetchFn } from '../youtube/data-api.js';
import { readResearch, scanChannel, sourceErrors } from './scan.js';

export interface ResearchDeps {
  queue: JobQueue;
  storeFor: (channelDir: string) => WriteStore;
  /** Đọc khóa `youtube_api_key` lúc chạy (người dùng có thể thêm khóa sau khi mở app). */
  apiKey: () => string | undefined;
  fetch?: FetchFn;
  now?: () => Date;
  appDataDir?: string;
}

const JOB = 'research.scan';

/** Job quét nghiên cứu (mạng, vài giây → luôn chạy nền, D4 2.3); một lần quét mỗi lúc. */
export function defineResearchJob(d: ResearchDeps): void {
  d.queue.define(JOB, {
    engine: 'research',
    idempotent: true,
    run: async (job) => {
      const { doc, path } = await scanChannel(d.storeFor(job.channel_dir!), {
        apiKey: d.apiKey(),
        ...(d.fetch ? { fetch: d.fetch } : {}),
        ...(d.now ? { now: d.now() } : {}),
        ...(d.appDataDir ? { appDataDir: d.appDataDir } : {}),
      });
      return {
        path,
        date: doc.date,
        quota_units: doc.quota_units,
        candidates: doc.candidates.length,
        errors: sourceErrors(doc),
      };
    },
  });
}

/** Tool `research.*` (D4 2.4, 049): quét nghiên cứu của kênh và đọc kết quả. */
export function researchTools(d: ResearchDeps): ToolDefinition[] {
  return [
    {
      name: 'research.scan',
      description:
        'Quét nghiên cứu hôm nay cho kênh: video mới + video nổi bật cũ của đối thủ, trending, Google Trends, tin Google News theo chủ đề trụ cột → chấm điểm chủ đề kèm lý do, ghi research/<ngày>.json. Chạy nền → job; xong thì đọc bằng research.get.',
      input: { type: 'object', properties: {}, additionalProperties: false },
      returnsJob: true,
      handler: async (_i: Record<string, never>, ctx) => {
        const job = d.queue.enqueue(JOB, { channel_dir: ctx.store.root, max_attempts: 1 });
        return { job_id: job.id };
      },
    },
    {
      name: 'research.get',
      description:
        'Kết quả quét nghiên cứu của kênh (chủ đề ứng viên điểm cao trước, lý do, nguồn lỗi). date: YYYY-MM-DD; bỏ trống = lần quét gần nhất.',
      input: {
        type: 'object',
        properties: { date: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' } },
        additionalProperties: false,
      },
      handler: async (i: { date?: string }, ctx) => {
        const doc = readResearch(ctx.store.root, i.date);
        if (!doc)
          throw new SfError(
            'E_FILE_NOT_FOUND',
            i.date
              ? `no research scan for ${i.date}; run research.scan`
              : 'no research scan yet; run research.scan',
          );
        return doc;
      },
    },
  ];
}
