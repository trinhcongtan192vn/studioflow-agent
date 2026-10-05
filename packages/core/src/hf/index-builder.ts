import { existsSync, readFileSync } from 'node:fs';
import type { AudioMeta, CaptionGroups, CaptionOverrides } from '../contracts/types.js';
import type { Builder } from '../graph/graph.js';
import { canonicalJson, sha256 } from '../domain/hash.js';
import { markUsed, trackById } from '../music/library.js';
import { renderBed, type MusicSegment } from '../music/mix.js';
import type { FrameTiming } from '../graph/timing.js';
import type { WriteStore } from '../store/writer.js';
import { applyCaptionOverrides, buildCaptionsHtml, lineWordsOf } from './captions-html.js';
import { buildIndexHtml, type IndexInput } from './index-html.js';
import { loadOutputProfile } from './outputs.js';
import { overlayInstances } from '../finish/overlays.js';
import { SfError } from '../errors.js';

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

/**
 * Builder nút `index` (D4 mục 8.1): `index.html` + `compositions/captions.html` + `hyperframes.json` +
 * bed nhạc đã ducking (012).
 */
export const indexBuilder =
  (deps: { appDataDir?: string } = {}): Builder =>
  async (ctx) => {
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
      const groups = applyCaptionOverrides(cg, overrides, lineWordsOf(meta))
        .filter((g) => lineAbs.has(g.line_id) && metaLine.has(g.line_id))
        .map((g) => {
          const ml = metaLine.get(g.line_id)!;
          const shift = lineAbs.get(g.line_id)!.start_ms - ml.start_ms; // chuỗi lời đọc → mốc video
          const abs_start_ms = g.start_ms + shift;
          const abs_end_ms = g.end_ms + shift;
          // chữ sửa tay → một khối; còn lại tô từng từ, mốc kẹp trong cụm (mép đã kéo, 026)
          const words = g.text_override
            ? [{ text: g.text, start_ms: abs_start_ms }]
            : ml.words.slice(g.word_range[0], g.word_range[1] + 1).map((w) => ({
                text: w.text,
                start_ms: Math.min(
                  abs_end_ms,
                  Math.max(abs_start_ms, lineAbs.get(g.line_id)!.start_ms + w.start_ms),
                ),
              }));
          return { ...g, abs_start_ms, abs_end_ms, words };
        });
      ctx.store.write(
        `${v}/compositions/captions.html`,
        buildCaptionsHtml({
          width: profile.width,
          height: profile.height,
          groups,
          style: cg.style,
          // 031: phụ đề theo người nói
          speakerColors: Object.fromEntries(
            Object.entries(ctx.model.cast)
              .filter(([, m]) => typeof m.caption_color === 'string')
              .map(([id, m]) => [id, m.caption_color as string]),
          ),
        }),
        {
          by: 'graph.build',
          validate: false,
        },
      );
      outputs.push('compositions/captions.html');
    }
    const music = await musicBed(ctx, timing, voices, deps.appDataDir);
    if (music) outputs.push(music.file, ...music.copies);
    // overlay theo frame (027, FR-CP-05)
    const ov = overlayInstances(ctx.model, timing, profile, deps.appDataDir);
    if (ov.problems.length) throw new SfError('E_SCHEMA_INVALID', ov.problems.join('; '));
    for (const o of ov.instances) {
      ctx.store.write(`${v}/${o.file}`, o.html, { by: 'graph.build', validate: false });
      outputs.push(o.file);
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
      overlays: ov.instances,
      ...(music ? { music: music.element } : {}),
      total_ms: timing.total_ms,
    });
    ctx.store.write(`${v}/index.html`, html, { by: 'graph.build', validate: false });
    return { outputs };
  };

/**
 * Bed nhạc (012, D8 mục 3): đoạn theo scene (scene liền nhau cùng bài nối liền), chép bài vào
 * `public/music/<mt>.<ext>`, trộn bằng FFmpeg (−24 LUFS, `music.volume_db`, ducking `music.duck_db`,
 * fade 1 000 ms) vào `public/music/bed-<hash>.wav` (dựng lại khi đầu vào đổi).
 */
async function musicBed(
  ctx: Parameters<Builder>[0],
  timing: FrameTiming,
  voices: { start_ms: number; duration_ms: number }[],
  appDataDir: string | undefined,
): Promise<
  { file: string; copies: string[]; element: NonNullable<IndexInput['music']> } | undefined
> {
  if (!appDataDir) return undefined;
  const v = ctx.videoRel;
  const segs: (MusicSegment & { ext: string; hash: string })[] = [];
  for (const sc of ctx.model.scenes) {
    const m = sc.music;
    if (!m || m === 'none' || !m.track_id) continue;
    const fr = timing.frames.filter((f) => sc.frame_ids.includes(f.id as never));
    if (!fr.length) continue;
    const found = trackById(ctx.store, appDataDir, m.track_id);
    if (!found) throw new Error(`scene ${sc.id}: music track ${m.track_id} is not in the library`);
    const start = Math.min(...fr.map((f) => f.start_ms));
    const end = Math.max(...fr.map((f) => f.start_ms + f.duration_ms));
    const volume = m.volume_db ?? Number(ctx.model.config('music.volume_db', { sceneId: sc.id }));
    const prev = segs[segs.length - 1];
    if (
      prev &&
      prev.track_id === m.track_id &&
      prev.end_ms === start &&
      prev.volume_db === volume
    ) {
      prev.end_ms = end;
      continue;
    }
    const ext = found.track.file.slice(found.track.file.lastIndexOf('.'));
    segs.push({
      track_id: m.track_id,
      file: found.abs,
      start_ms: start,
      end_ms: end,
      volume_db: volume,
      ext,
      hash: found.track.hash,
    });
  }
  if (!segs.length) return undefined;
  const copies: string[] = [];
  for (const s of new Map(segs.map((x) => [x.track_id, x])).values()) {
    const rel = `public/music/${s.track_id}${s.ext}`;
    if (!existsSync(ctx.store.abs(`${v}/${rel}`))) {
      ctx.store.write(`${v}/${rel}`, readFileSync(s.file), { by: 'graph.build', validate: false });
    }
    copies.push(rel);
    const found = trackById(ctx.store, appDataDir, s.track_id)!;
    markUsed(found.lib, s.track_id, ctx.videoId);
  }
  const duck = Number(ctx.model.config('music.duck_db'));
  const voice = voices.map((x) => ({ start_ms: x.start_ms, end_ms: x.start_ms + x.duration_ms }));
  const key = sha256(
    canonicalJson({
      segs: segs.map((s) => ({ ...s, file: undefined })),
      voice,
      total: timing.total_ms,
      duck,
    }),
  );
  const file = `public/music/bed-${key.slice(0, 12)}.wav`;
  if (!existsSync(ctx.store.abs(`${v}/${file}`))) {
    const wav = await renderBed(
      { segments: segs, voice, total_ms: timing.total_ms, duck_db: duck },
      ctx.signal,
    );
    ctx.store.write(`${v}/${file}`, wav, { by: 'graph.build', validate: false });
  }
  return {
    file,
    copies,
    element: {
      file,
      track_ids: [...new Set(segs.map((s) => s.track_id))],
      volume_db: segs[0]!.volume_db,
      duck_db: duck,
      fade_ms: 1000,
    },
  };
}
