import { SfError } from '../errors.js';
import type { ToolDefinition } from '../gateway/types.js';
import { BuildGraph, lipsyncLines, type BuilderRegistry } from '../graph/graph.js';
import { loadVideoModel } from '../graph/model.js';
import type { JobQueue } from '../jobs/queue.js';
import type { StepExecutor } from '../workflow/engine.js';
import { registerObjective } from '../workflow/gates.js';
import { DEFAULT_MOUTH_SET, mouthDir } from './mouths.js';

/**
 * Frame cần khẩu hình mà thiếu cấu hình (FN-032 mục 5): `lipsync.enabled` ở frame, có line của nhân vật,
 * nhưng thiếu `lipsync.cast_id`/`mouth_anchor`, anchor không phải layer `mouth`, hoặc không có bộ miệng.
 */
export function lipsyncAnchorProblems(
  channelDir: string,
  videoId: string,
  appDataDir?: string,
): string[] {
  const model = loadVideoModel(channelDir, videoId, appDataDir);
  const out: string[] = [];
  for (const f of model.frames) {
    if (model.config('lipsync.enabled', { sceneId: f.scene_id, frameId: f.id }) !== true) continue;
    const speakers = new Set(
      f.line_ids
        .map((id) => model.lines.find((l) => l.id === id)?.speaker)
        .filter((s) => !!s && s !== 'narrator') as string[],
    );
    if (!f.lipsync) {
      // shot toàn cảnh/không nhìn máy quay: không lip-sync là hợp lệ
      continue;
    }
    if (!speakers.has(f.lipsync.cast_id))
      out.push(`frame ${f.id}: lipsync cast ${f.lipsync.cast_id} does not speak in this frame`);
    const layer = f.layers.find((l) => l.id === f.lipsync!.mouth_anchor);
    if (!layer || layer.kind !== 'mouth')
      out.push(
        `frame ${f.id}: mouth_anchor ${f.lipsync.mouth_anchor} must be a layer of kind mouth`,
      );
    const set = model.cast[f.lipsync.cast_id]?.mouth_set ?? DEFAULT_MOUTH_SET;
    if (!mouthDir(set, 'front', appDataDir))
      out.push(`frame ${f.id}: mouth set ${set} is not installed`);
  }
  return out;
}

registerObjective('lipsync_anchors', (g) => {
  const p = lipsyncAnchorProblems(g.store.root, g.videoId, g.appDataDir);
  return p.length ? { pass: false, detail: p.join('; ') } : { pass: true };
});

/** Executor bước `lipsync` (D6 mục 2, 032): dựng nút `lipsync.line` của các shot bật khẩu hình. */
export function lipsyncExecutor(builders: BuilderRegistry): StepExecutor {
  return async (ctx) => {
    const problems = lipsyncAnchorProblems(ctx.store.root, ctx.videoId, ctx.appDataDir);
    if (problems.length) throw new SfError('E_GATE_FAILED', problems.join('; '));
    const model = loadVideoModel(ctx.store.root, ctx.videoId, ctx.appDataDir);
    const targets = [...lipsyncLines(model).keys()].map((ln) => `lipsync.line:${ln}`);
    if (!targets.length) return { outputs: [], summary: 'Không có shot nào bật khẩu hình.' };
    const graph = new BuildGraph({ store: ctx.store, appDataDir: ctx.appDataDir, builders });
    const r = await graph.build(ctx.videoId, { targets, signal: ctx.signal });
    if (r.status !== 'succeeded')
      throw new SfError('E_PROVIDER_FAILED', `lipsync build: ${r.status}`);
    return {
      outputs: targets.map((t) => `lipsync/${t.split(':')[1]}.json`),
      summary: `Khẩu hình cho ${targets.length} line.`,
    };
  };
}

/** Tool `lipsync.cues {line_ids}` (D4 mục 2.4) → job dựng nút `lipsync.line`. */
export function lipsyncTools(queue: JobQueue): ToolDefinition[] {
  return [
    {
      name: 'lipsync.cues',
      description:
        'Tính khẩu hình (closed/half/open theo từng video frame) cho các line của nhân vật trong shot bật lip-sync → job; line_ids hoặc "all".',
      returnsJob: true,
      input: {
        type: 'object',
        properties: {
          line_ids: {
            oneOf: [
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
      async handler(input: { line_ids: string[] | 'all' }, ctx) {
        if (!ctx.session.video_id)
          throw new SfError('E_CONFIG_SCOPE', 'lipsync.cues needs a video in this session');
        const model = loadVideoModel(ctx.store.root, ctx.session.video_id, ctx.appDataDir);
        const eligible = [...lipsyncLines(model).keys()];
        const ids = input.line_ids === 'all' ? eligible : input.line_ids;
        const bad = ids.filter((id) => !eligible.includes(id));
        if (bad.length)
          throw new SfError(
            'E_SCHEMA_INVALID',
            `lines ${bad.join(', ')} are not in a lip-sync shot (frame lipsync + lipsync.enabled)`,
          );
        const job = queue.enqueue('graph.build', {
          channel_dir: ctx.store.root,
          video_id: ctx.session.video_id,
          payload: {
            targets: ids.map((id) => `lipsync.line:${id}`),
            appDataDir: ctx.appDataDir ?? null,
          },
        });
        return { job_id: job.id };
      },
    },
  ];
}
