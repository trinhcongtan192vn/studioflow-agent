import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { CastMember, Frame, Line, Scene } from '../contracts/types.js';
import { resolveConfig } from '../config/resolve.js';
import { isAutopilotVideo } from '../domain/autopilot.js';
import { sha256 } from '../domain/hash.js';
import { parseBlocksDoc } from '../domain/markdown/blocks.js';
import { parseScript, toScriptDoc } from '../domain/markdown/script.js';
import { parseStoryboard, toStoryboardDoc } from '../domain/markdown/storyboard.js';

/** Dữ liệu một video cần để dựng build graph (đọc từ artifact nguồn). */
export interface VideoModel {
  channelDir: string;
  videoId: string;
  videoDir: string;
  language: string;
  lines: Line[];
  frames: Frame[];
  scenes: Scene[];
  cast: Record<string, Partial<CastMember>>;
  /** 052: video do Autopilot tạo — người nói chưa có giọng dùng giọng mặc định của kênh. */
  autopilot: boolean;
  config<T = unknown>(key: string, scope?: { sceneId?: string; frameId?: string }): T;
  /** Hash nội dung một file/thư mục trong video (thiếu → null). */
  hashOf(rel: string): string | null;
  /** Hash nội dung một thư mục trong kênh (ví dụ `voices/<vo>`). */
  hashChannelDir(rel: string): string | null;
}

function hashDir(dir: string): string | null {
  if (!existsSync(dir)) return null;
  const parts: string[] = [];
  const walk = (d: string, rel: string) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p, `${rel}${e.name}/`);
      else parts.push(`${rel}${e.name}:${sha256(readFileSync(p))}`);
    }
  };
  walk(dir, '');
  return sha256(parts.join('\n'));
}

export function loadVideoModel(
  channelDir: string,
  videoId: string,
  appDataDir?: string,
): VideoModel {
  const videoDir = path.join(channelDir, 'videos', videoId);
  const read = (f: string) =>
    existsSync(path.join(videoDir, f)) ? readFileSync(path.join(videoDir, f), 'utf8') : undefined;
  const scriptText = read('SCRIPT.md');
  const script = scriptText ? toScriptDoc(parseScript(scriptText)) : undefined;
  const sbText = read('STORYBOARD.md');
  const sb = sbText ? toStoryboardDoc(parseStoryboard(sbText)) : undefined;
  const cast: Record<string, Partial<CastMember>> = {};
  const chars = path.join(channelDir, 'characters');
  if (existsSync(chars)) {
    for (const d of readdirSync(chars)) {
      const f = path.join(chars, d, 'cast.json');
      if (existsSync(f)) cast[d] = JSON.parse(readFileSync(f, 'utf8')) as CastMember;
    }
  }
  const castText = read('CAST.md');
  if (castText) {
    const block = parseBlocksDoc(castText).blocks.find((b) => b.tag === 'sf-cast');
    for (const c of (block?.data as Partial<CastMember>[] | undefined) ?? []) {
      if (c?.id) cast[c.id] = { ...cast[c.id], ...c };
    }
  }
  const autopilot = isAutopilotVideo(channelDir, videoId);
  const channel = JSON.parse(readFileSync(path.join(channelDir, 'channel.json'), 'utf8')) as {
    language: string;
  };
  return {
    channelDir,
    videoId,
    videoDir,
    language: script?.front.language ?? channel.language,
    // khoảng lặng mặc định sau line (`voice.pause_after_ms`, 029; essay 600 ms)
    lines: withDefaultPause(script?.lines ?? [], () =>
      Number(
        resolveConfig('voice.pause_after_ms', { channelDir, videoId }, { appDataDir }).value ?? 0,
      ),
    ),
    frames: sb?.frames ?? [],
    scenes: sb?.scenes ?? [],
    cast,
    autopilot,
    config: (key, scope = {}) =>
      resolveConfig(key, { channelDir, videoId, ...scope }, { appDataDir }).value as never,
    hashOf: (rel) => {
      const p = path.join(videoDir, ...rel.split('/'));
      if (!existsSync(p)) return null;
      return statSync(p).isDirectory() ? hashDir(p) : sha256(readFileSync(p));
    },
    hashChannelDir: (rel) => hashDir(path.join(channelDir, ...rel.split('/'))),
  };
}

/** Giọng của line: narrator → `voice.id`; nhân vật → `voice_id` của cast (D3 4, 7.2). */
export function voiceOf(model: VideoModel, line: Line): string | null {
  if (line.speaker === 'narrator') return model.config<string | null>('voice.id');
  const c = model.cast[line.speaker];
  // 036: người dẫn khai trong CAST.md (role narrator) mà không có giọng riêng → giọng người dẫn
  if (c?.role === 'narrator')
    return (c.voice_id as string | undefined) ?? model.config<string | null>('voice.id');
  // 052: video Autopilot không có người chọn giọng → nhân vật chưa có giọng dùng `voice.id` của kênh
  return (
    (c?.voice_id as string | undefined) ??
    (model.autopilot ? model.config<string | null>('voice.id') : null)
  );
}

/** Line không khai báo `pause_after_ms` nhận `voice.pause_after_ms` (D3 7.2, 029). */
export function withDefaultPause<L extends { pause_after_ms?: number }>(
  lines: L[],
  pause: () => number,
): L[] {
  if (lines.every((l) => l.pause_after_ms !== undefined)) return lines;
  const p = pause();
  return p > 0
    ? lines.map((l) => (l.pause_after_ms === undefined ? { ...l, pause_after_ms: p } : l))
    : lines;
}
