import type { BuilderRegistry } from '../graph/graph.js';
import type { StepExecutor, StepRunContext } from './engine.js';
import { captionsExecutor, finalizeExecutor } from './finalize.js';

/**
 * Bước `compose` (luồng v2): dựng toàn bộ hình rồi kiểm — (1) frame từ bộ layout (0 token; frame `hero` do phiên
 * frame AI dựng khi bật `advanced.custom_frames`, lỗi → layout), lắp `index.html`, lint/check; (2) phụ đề;
 * (3) build toàn graph (nhạc nền, overlay), `hyperframes check`, contact sheet, bản nháp để duyệt. Gate của bước
 * (thời lượng, vùng an toàn — tự co chữ, `asr_clean`) chạy sau, tự sửa được thì sửa.
 */
export function composeExecutor(d: { builders: BuilderRegistry; frames: StepExecutor }) {
  const captions = captionsExecutor(d.builders);
  const finalize = finalizeExecutor(d.builders);
  return async (ctx: StepRunContext): Promise<{ outputs: string[]; summary: string }> => {
    const part = (from: number, to: number) => (done: number, total: number, msg?: string) =>
      ctx.progress?.(Math.round(from + ((to - from) * done) / Math.max(1, total)), 100, msg ?? '');
    const frames = await d.frames({ ...ctx, progress: part(0, 50) });
    await captions({ ...ctx, progress: part(50, 55) });
    const fin = await finalize({ ...ctx, progress: part(55, 100) });
    return {
      outputs: [...new Set([...(frames.outputs ?? []), 'caption_groups.json', ...fin.outputs])],
      summary: [frames.summary, fin.summary].filter(Boolean).join(' '),
    };
  };
}
