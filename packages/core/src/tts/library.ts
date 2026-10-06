import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveConfig } from '../config/resolve.js';
import type { CastMember } from '../contracts/types.js';
import type { ToolDefinition } from '../gateway/types.js';

const readJson = <T>(f: string): T | undefined => {
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as T;
  } catch {
    return undefined;
  }
};
const dirs = (d: string) =>
  existsSync(d)
    ? readdirSync(d, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
    : [];

/** Nhân vật cấp kênh `characters/<ca>/cast.json` (D3 mục 2). */
function channelCast(channelDir: string): Partial<CastMember>[] {
  const root = path.join(channelDir, 'characters');
  return dirs(root)
    .map((id) => readJson<Partial<CastMember>>(path.join(root, id, 'cast.json')))
    .filter((c): c is Partial<CastMember> => Boolean(c?.id));
}

interface VoiceProfile {
  voice_id: string;
  name?: string;
  language?: string;
  created_at?: string;
  design?: { instruct: string; seed?: number };
  suggested_for?: string;
}

export interface VoiceEntry {
  voice_id: string;
  name: string;
  language: string;
  kind: 'cloned' | 'designed';
  /** Có `voice.pt` (dùng được ngay cho TTS). */
  ready: boolean;
  design?: { instruct: string };
  suggested_for?: string;
  /** `narrator` (là `voice.id` hiện tại) và các `ca_…` đang dùng giọng này. */
  used_by: string[];
  created_at?: string;
}

/** Giọng của kênh `voices/<vo>/` kèm ai đang dùng (035 FR-001). */
export function listVoices(
  channelDir: string,
  videoId: string | undefined,
  appDataDir?: string,
): { narrator_voice_id: string | null; voices: VoiceEntry[] } {
  const narrator =
    resolveConfig<string | null>(
      'voice.id',
      { channelDir, ...(videoId ? { videoId } : {}) },
      { appDataDir },
    ).value ?? null;
  const cast = channelCast(channelDir);
  const root = path.join(channelDir, 'voices');
  const voices = dirs(root)
    .map((id): VoiceEntry | undefined => {
      const p = readJson<VoiceProfile>(path.join(root, id, 'profile.json'));
      if (!p) return undefined;
      return {
        voice_id: id,
        name: p.name ?? id,
        language: p.language ?? '',
        kind: p.design ? 'designed' : 'cloned',
        ready: existsSync(path.join(root, id, 'voice.pt')),
        ...(p.design ? { design: { instruct: p.design.instruct } } : {}),
        ...(p.suggested_for ? { suggested_for: p.suggested_for } : {}),
        used_by: [
          ...(narrator === id ? ['narrator'] : []),
          ...cast.filter((c) => c.voice_id === id).map((c) => c.id!),
        ],
        ...(p.created_at ? { created_at: p.created_at } : {}),
      };
    })
    .filter((v): v is VoiceEntry => Boolean(v));
  return { narrator_voice_id: narrator, voices };
}

/** Nhân vật cấp kênh để dùng lại (035 FR-002). */
export function listCast(channelDir: string) {
  const names = Object.fromEntries(
    dirs(path.join(channelDir, 'voices')).map((id) => [
      id,
      readJson<VoiceProfile>(path.join(channelDir, 'voices', id, 'profile.json'))?.name,
    ]),
  );
  return {
    characters: channelCast(channelDir).map((c) => ({
      id: c.id!,
      name: c.name ?? c.id!,
      ...(c.voice_id ? { voice_id: c.voice_id } : {}),
      ...(c.voice_id && names[c.voice_id] ? { voice_name: names[c.voice_id] } : {}),
      ...(c.caption_color ? { caption_color: c.caption_color } : {}),
      reference_images: c.reference_images?.length ?? 0,
      expressions: Object.keys(c.expressions ?? {}),
    })),
  };
}

/** Tool chỉ đọc `voice.list`, `cast.list` (D4 mục 2.4, 035). */
export function libraryTools(appDataDir?: string): ToolDefinition[] {
  const none = { type: 'object', properties: {}, additionalProperties: false };
  return [
    {
      name: 'voice.list',
      description:
        'Giọng có sẵn của kênh (clone hoặc gợi ý) kèm ai đang dùng, giọng người dẫn hiện tại. Gọi TRƯỚC khi tạo giọng mới để dùng lại (035).',
      input: none,
      handler: async (_i: Record<string, never>, ctx) =>
        listVoices(ctx.store.root, ctx.session.video_id, appDataDir),
    },
    {
      name: 'cast.list',
      description:
        'Nhân vật cấp kênh (characters/*/cast.json) kèm giọng: dùng lại đúng id ca_… trong CAST.md để giữ giọng, ảnh chuẩn, biểu cảm (035).',
      input: none,
      handler: async (_i: Record<string, never>, ctx) => listCast(ctx.store.root),
    },
  ];
}
