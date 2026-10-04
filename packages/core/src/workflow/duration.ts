import { existsSync, readFileSync } from 'node:fs';
import type { AudioMeta } from '../contracts/types.js';
import { resolveConfig } from '../config/resolve.js';
import { withDefaultPause } from '../graph/model.js';
import { parseBlocksDoc } from '../domain/markdown/blocks.js';
import { parseScript, toScriptDoc } from '../domain/markdown/script.js';
import type { FrameTiming } from '../graph/timing.js';
import type { WriteStore } from '../store/writer.js';
import { registerObjective } from './gates.js';

/**
 * Thời lượng đo trên audio thật (D6 mục 4.2 `audio_duration`, 016 R4): tốc độ đọc phụ thuộc nội dung,
 * kịch bản và từng cảnh nên không ước từ số từ/phút.
 */
export interface BeatDuration {
  beat_id: string;
  title: string;
  start_ms: number;
  duration_ms: number;
}

function readAudioMeta(store: WriteStore, videoId: string): AudioMeta | undefined {
  const f = store.abs(`videos/${videoId}/audio_meta.json`);
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as AudioMeta) : undefined;
}

/** Thời lượng thật từng beat: audio của line + `pause_after_ms`, nối theo thứ tự `SCRIPT.md`. */
export function beatDurations(store: WriteStore, videoId: string): BeatDuration[] {
  const meta = readAudioMeta(store, videoId);
  const scriptF = store.abs(`videos/${videoId}/SCRIPT.md`);
  if (!meta || !existsSync(scriptF)) return [];
  const audio = new Map(meta.lines.map((l) => [l.line_id as string, l.duration_ms]));
  const doc = toScriptDoc(parseScript(readFileSync(scriptF, 'utf8')));
  const lines = withDefaultPause(doc.lines, () =>
    Number(resolveConfig('voice.pause_after_ms', { channelDir: store.root, videoId }).value ?? 0),
  );
  const byId = new Map(lines.map((l) => [l.id as string, l]));
  let t = 0;
  return doc.beats.map((b) => {
    const start = t;
    for (const id of b.line_ids) t += (audio.get(id) ?? 0) + (byId.get(id)?.pause_after_ms ?? 0);
    return { beat_id: b.id, title: b.title, start_ms: start, duration_ms: t - start };
  });
}

export function timingOf(store: WriteStore, videoId: string): FrameTiming | undefined {
  const f = store.abs(`videos/${videoId}/.sf/graph.json`);
  if (!existsSync(f)) return undefined;
  return (JSON.parse(readFileSync(f, 'utf8')) as { nodes: Record<string, { meta?: unknown }> })
    .nodes['frame_timing']?.meta as FrameTiming | undefined;
}

const sec = (ms: number) => `${Math.round(ms / 1000)} s`;

/**
 * So `BRIEF.md.target_duration_ms` trong `check.duration_tolerance`. `audio` (sau bước `voice`): tổng lời
 * đọc thật; `timeline` (`finalize`): thời lượng timeline. Trượt → nêu thời lượng thật từng beat.
 */
export function audioDurationCheck(
  store: WriteStore,
  videoId: string,
  appDataDir?: string,
  source: 'audio' | 'timeline' = 'audio',
): { pass: boolean; detail?: string } {
  const brief = parseBlocksDoc(readFileSync(store.abs(`videos/${videoId}/BRIEF.md`), 'utf8'))
    .front as { target_duration_ms?: number | null };
  const beats = beatDurations(store, videoId);
  if (!readAudioMeta(store, videoId)) return { pass: false, detail: 'audio_meta.json missing' };
  if (!brief.target_duration_ms) return { pass: true, detail: 'no target duration in BRIEF.md' };
  const timing = source === 'timeline' ? timingOf(store, videoId) : undefined;
  if (source === 'timeline' && !timing) return { pass: false, detail: 'no timeline yet' };
  const total = timing ? timing.total_ms : beats.reduce((s, b) => s + b.duration_ms, 0);
  const target = brief.target_duration_ms;
  const tol = Number(
    resolveConfig('check.duration_tolerance', { channelDir: store.root, videoId }, { appDataDir })
      .value,
  );
  if (Math.abs(total - target) / target <= tol) return { pass: true };
  return {
    pass: false,
    detail: `${sec(total)} vs target ${sec(target)} (±${Math.round(tol * 100)}%); beats: ${beats
      .map((b) => `${b.title} ${sec(b.duration_ms)}`)
      .join(', ')}`,
  };
}

registerObjective('audio_duration', (g, params) =>
  audioDurationCheck(
    g.store,
    g.videoId,
    g.appDataDir,
    params?.source === 'timeline' ? 'timeline' : 'audio',
  ),
);
