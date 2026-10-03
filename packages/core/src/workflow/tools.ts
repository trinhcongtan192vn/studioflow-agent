import { SfError } from '../errors.js';
import type { ToolContext, ToolDefinition } from '../gateway/types.js';
import type { WorkflowService } from './service.js';

const stepInput = {
  type: 'object',
  properties: { step_id: { type: 'string' } },
  required: ['step_id'],
  additionalProperties: false,
};

/** Tool `workflow.*`, `approval.annotate` (D4 mục 2.4). */
export function workflowTools(svc: WorkflowService): ToolDefinition[] {
  const engine = (ctx: ToolContext) => {
    if (!ctx.session.video_id)
      throw new SfError('E_SCOPE_DENIED', 'no video selected in this session');
    return svc.engine(ctx.store.root, ctx.session.video_id);
  };
  return [
    {
      name: 'workflow.list',
      description: 'Workflow đã cài và tương thích.',
      input: { type: 'object', additionalProperties: false },
      handler: async () => ({
        workflows: svc
          .packs()
          .filter((p) => p.compatible)
          .map(({ manifest: m }) => ({
            id: m.id,
            version: m.version,
            title: m.title,
            description: m.description,
            output_profiles: m.output_profiles,
          })),
      }),
    },
    {
      name: 'workflow.select',
      description:
        'Chọn workflow + output profile cho video ở pha briefing; ghi đề xuất vào BRIEF.md, tạo điểm duyệt brief.',
      input: {
        type: 'object',
        properties: { workflow_id: { type: 'string' }, output_profile: { type: 'string' } },
        required: ['workflow_id', 'output_profile'],
        additionalProperties: false,
      },
      handler: async (i: { workflow_id: string; output_profile: string }, ctx) => {
        await engine(ctx).select(i.workflow_id, i.output_profile);
        return {};
      },
    },
    {
      name: 'workflow.state',
      description: 'Trạng thái workflow của video (bước, điểm duyệt, ngân sách).',
      input: { type: 'object', additionalProperties: false },
      handler: async (_i, ctx) => engine(ctx).summary(),
    },
    {
      name: 'workflow.run_to',
      description: 'Chạy liên tiếp tới hết bước đích (dừng ở điểm duyệt/lỗi).',
      input: stepInput,
      handler: async (i: { step_id: string }, ctx) => {
        void engine(ctx).runTo(i.step_id);
        return {};
      },
    },
    {
      name: 'workflow.pause',
      description: 'Dừng sau bước đang chạy.',
      input: { type: 'object', additionalProperties: false },
      handler: async (_i, ctx) => {
        engine(ctx).pause();
        return {};
      },
    },
    {
      name: 'workflow.rewind',
      description: 'Quay lại một bước: bước đó chạy lại, mọi bước sau thành lỗi thời.',
      input: stepInput,
      handler: async (i: { step_id: string }, ctx) => {
        await engine(ctx).rewind(i.step_id);
        return {};
      },
    },
    {
      name: 'workflow.step_complete',
      description: 'Báo đã xong bước do agent thực hiện (kèm file đầu ra).',
      input: {
        type: 'object',
        properties: {
          step_id: { type: 'string' },
          frame_id: { type: 'string' },
          outputs: { type: 'array', items: { type: 'string' } },
          new_element_ids: { type: 'array', items: { type: 'string' } },
        },
        required: ['step_id', 'outputs'],
        additionalProperties: false,
      },
      handler: async (i: { step_id: string; outputs: string[] }, ctx) =>
        engine(ctx).stepComplete(i.step_id, i.outputs),
    },
    {
      name: 'workflow.gate_check',
      description: 'Kiểm gate của một bước (không đổi trạng thái).',
      input: stepInput,
      handler: async (i: { step_id: string }, ctx) => engine(ctx).gateCheck(i.step_id),
    },
    {
      name: 'approval.annotate',
      description: 'Gắn tóm tắt cho thẻ duyệt đang chờ của một bước.',
      input: {
        type: 'object',
        properties: { step_id: { type: 'string' }, summary: { type: 'string', maxLength: 2000 } },
        required: ['step_id', 'summary'],
        additionalProperties: false,
      },
      handler: async (i: { step_id: string; summary: string }, ctx) => {
        await engine(ctx).annotate(i.step_id, i.summary);
        return {};
      },
    },
  ];
}
