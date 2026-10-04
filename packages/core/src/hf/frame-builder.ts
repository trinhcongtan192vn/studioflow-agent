import { existsSync, readFileSync } from 'node:fs';
import { SfError } from '../errors.js';
import type { Builder } from '../graph/graph.js';
import type { WriteStore } from '../store/writer.js';
import { checkFrameFile } from './frame-file.js';

/** Dựng lại một frame bằng phiên agent `frame` (WorkflowService, 020 R1). */
export type FrameRebuilder = (i: {
  store: WriteStore;
  videoId: string;
  frameId: string;
  signal: AbortSignal;
}) => Promise<void>;

/**
 * Builder nút `frame_html` (D4 mục 8.1): file frame hợp lệ chưa có bản ghi → nhận vào graph; thiếu hoặc
 * lỗi thời → phiên `frame` dựng lại đúng frame đó. Không có bộ dựng lại → `E_STEP_INCOMPLETE`.
 */
export function frameHtmlBuilder(deps: { rebuild: () => FrameRebuilder | undefined }): Builder {
  return async (ctx) => {
    const rel = `compositions/frames/${ctx.key}.html`;
    const abs = ctx.store.abs(`${ctx.videoRel}/${rel}`);
    const frame = ctx.model.frames.find((f) => f.id === ctx.key)!;
    const layerIds = frame.layers.map((l) => l.id);
    const valid = () =>
      existsSync(abs) && checkFrameFile(readFileSync(abs, 'utf8'), ctx.key, layerIds).length === 0;
    if (!ctx.records[ctx.nodeId] && valid()) return { outputs: [rel] };
    const rebuild = deps.rebuild();
    if (!rebuild)
      throw new SfError(
        'E_STEP_INCOMPLETE',
        `frame ${ctx.key} needs to be rebuilt by a frame agent; run the frame-build step`,
      );
    await rebuild({ store: ctx.store, videoId: ctx.videoId, frameId: ctx.key, signal: ctx.signal });
    if (!valid()) {
      const problems = existsSync(abs)
        ? checkFrameFile(readFileSync(abs, 'utf8'), ctx.key, layerIds).map((p) => p.message)
        : [`${rel} was not written`];
      throw new SfError('E_PROVIDER_FAILED', `frame ${ctx.key}: ${problems.join('; ')}`);
    }
    return { outputs: [rel] };
  };
}
