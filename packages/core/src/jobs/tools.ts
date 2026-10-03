import { SfError } from '../errors.js';
import type { ToolDefinition } from '../gateway/types.js';
import type { JobQueue, QueuedJob } from './queue.js';

/** JobInfo đúng hợp đồng D4 mục 5 (bỏ trường nội bộ). */
function info(j: QueuedJob) {
  const rest: Partial<QueuedJob> = { ...j };
  delete rest.payload;
  delete rest.parent_id;
  delete rest.channel_dir;
  return rest;
}

export function jobTools(queue: JobQueue): ToolDefinition[] {
  const must = (id: string) => {
    const j = queue.get(id);
    if (!j) throw new SfError('E_ID_UNKNOWN', `job ${id} not found`);
    return j;
  };
  const idInput = {
    type: 'object',
    properties: { job_id: { type: 'string' } },
    required: ['job_id'],
    additionalProperties: false,
  };
  return [
    {
      name: 'job.status',
      description: 'Trạng thái một job.',
      input: idInput,
      handler: async (i: { job_id: string }) => info(must(i.job_id)),
    },
    {
      name: 'job.wait',
      description: 'Chờ job xong (hoặc hết timeout_ms, mặc định 60 000) rồi trả trạng thái.',
      input: {
        type: 'object',
        properties: {
          job_id: { type: 'string' },
          timeout_ms: { type: 'number', minimum: 0, maximum: 600000 },
        },
        required: ['job_id'],
        additionalProperties: false,
      },
      handler: async (i: { job_id: string; timeout_ms?: number }) => {
        must(i.job_id);
        return info(await queue.wait(i.job_id, i.timeout_ms ?? 60_000));
      },
    },
    {
      name: 'job.cancel',
      description: 'Hủy job (job đã xong không đổi).',
      input: idInput,
      handler: async (i: { job_id: string }) => info(queue.cancel(i.job_id)),
    },
    {
      name: 'job.list',
      description: 'Liệt kê job của video hiện tại (lọc theo status nếu có).',
      input: {
        type: 'object',
        properties: { status: { type: 'string' } },
        additionalProperties: false,
      },
      handler: async (i: { status?: string }, ctx) => ({
        jobs: queue.list({ status: i.status, video_id: ctx.session.video_id }).map(info),
      }),
    },
  ];
}
