import { existsSync, readFileSync } from 'node:fs';
import type { AudioMeta, CaptionGroups, CaptionOverrides } from '../contracts/types.js';
import type { Builder } from '../graph/graph.js';
import type { FrameTiming } from '../graph/timing.js';
import type { WriteStore } from '../store/writer.js';
import { applyCaptionOverrides, buildCaptionsHtml } from './captions-html.js';
import { buildIndexHtml } from './index-html.js';
import { loadOutputProfile } from './outputs.js';

/** `hyperframes.json` của video (D4 mục 9.1) — theo mẫu `hyperframes init` v0.8.115. */
export const HYPERFRAMES_JSON = {
  $schema: 'https://hyperframes.heygen.com/schema/hyperframes.json',
  registry: 'https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry',
  paths: { blocks: 'compositions', components: 'compositions/components', assets: 'public' },
  media: { autoProxy: true },
};

export function ensureHfProject(store: WriteStore, videoId: string): void {
  const rel = `videos/${videoId}/hyperframes.json`;
  const want = `${JSON.stringify(HYPERFRAMES_JSON, null, 2)}\n`;
  if (!existsSync(store.abs(rel)) || readFileSync(store.abs(rel), 'utf8') !== want) {
    store.write(rel, want, { by: 'hf.adapter', validate: false });
  }
}

/** Màu nền canvas trong `frame.md` (`canvas: #xxxxxx` hoặc `--canvas`). */
export function groundColor(frameMd: string | undefined): string | undefined {
  if (!frameMd) return undefined;
  return /\bcanvas\b[^#\n]*?(#[0-9a-fA-F]{3,8})\b/.exec(frameMd)?.[1];
}

/** Builder nút `index` (D4 mục 8.1): `index.html` + `compositions/captions.html` + `hyperframes.json`. */
export const indexBuilder: Builder = async (ctx) => {
  const v = ctx.videoRel;
  const read = (rel: string) =>
    existsSync(ctx.store.abs(`${v}/${rel}`))
      ? readFileSync(ctx.store.abs(`${v}/${rel}`), 'utf8')
      : undefined;
  const timing = ctx.records['frame_timing']?.meta as FrameTiming | undefined;
  if (!timing) throw new Error('frame_timing is not built');
  const missing = ctx.model.frames
    .filter((f) => !existsSync(ctx.store.abs(`${v}/compositions/frames/${f.id}.html`)))
    .map((f) => f.id);
  if (missing.length) throw new Error(`frames not built yet: ${missing.join(', ')}`);
  const profile = loadOutputProfile(ctx.model.config('output.profile') as string | null);
  const meta = JSON.parse(read('audio_meta.json') ?? 'null') as AudioMeta | null;
  const lineAbs = new Map(timing.lines.map((l) => [l.id, l]));
  const voices = (meta?.lines ?? [])
    .filter((l) => lineAbs.has(l.line_id))
    .map((l) => ({
      line_id: l.line_id,
      file: l.file,
      start_ms: lineAbs.get(l.line_id)!.start_ms,
      duration_ms: l.duration_ms,
    }));
  const outputs = ['index.html', 'hyperframes.json'];
  ensureHfProject(ctx.store, ctx.videoId);
  const cg = JSON.parse(read('caption_groups.json') ?? 'null') as CaptionGroups | null;
  if (cg && meta) {
    const overrides = JSON.parse(
      read('caption-overrides.json') ?? 'null',
    ) as CaptionOverrides | null;
    const metaLine = new Map(meta.lines.map((l) => [l.line_id, l]));
    const groups = applyCaptionOverrides(cg, overrides ?? undefined)
      .filter((g) => lineAbs.has(g.line_id) && metaLine.has(g.line_id))
      .map((g) => {
        const ml = metaLine.get(g.line_id)!;
        const shift = lineAbs.get(g.line_id)!.start_ms - ml.start_ms; // chuỗi lời đọc → mốc video
        const orig = cg.groups.find((x) => x.id === g.id)!;
        const overridden = g.text !== orig.text;
        const words = overridden
          ? [{ text: g.text, start_ms: g.start_ms + shift }]
          : ml.words.slice(g.word_range[0], g.word_range[1] + 1).map((w) => ({
              text: w.text,
              start_ms: lineAbs.get(g.line_id)!.start_ms + w.start_ms,
            }));
        return { ...g, abs_start_ms: g.start_ms + shift, abs_end_ms: g.end_ms + shift, words };
      });
    ctx.store.write(
      `${v}/compositions/captions.html`,
      buildCaptionsHtml({ width: profile.width, height: profile.height, groups, style: cg.style }),
      {
        by: 'graph.build',
        validate: false,
      },
    );
    outputs.push('compositions/captions.html');
  }
  const html = buildIndexHtml({
    width: profile.width,
    height: profile.height,
    ground: groundColor(read('frame.md')),
    frames: ctx.model.frames.map((f) => {
      const t = timing.frames.find((x) => x.id === f.id)!;
      return {
        id: f.id,
        start_ms: t.start_ms,
        duration_ms: t.duration_ms,
        ...(f.transition_in ? { transition_in: f.transition_in } : {}),
      };
    }),
    voices,
    captions: outputs.includes('compositions/captions.html'),
    total_ms: timing.total_ms,
  });
  ctx.store.write(`${v}/index.html`, html, { by: 'graph.build', validate: false });
  return { outputs };
};
