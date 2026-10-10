import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveConfig, setConfig } from '../config/resolve.js';
import type { AudioMeta } from '../contracts/types.js';
import { sha256 } from '../domain/hash.js';
import { parseBlocksDoc, serializeBlocksDoc } from '../domain/markdown/blocks.js';
import { SfError } from '../errors.js';
import { loadVideoModel } from '../graph/model.js';
import { loadOutputProfile } from '../hf/outputs.js';
import { runFfmpeg } from '../music/mix.js';
import { listRenders } from '../render/export.js';
import { createScratchDir } from '../store/scratch.js';
import type { WriteStore } from '../store/writer.js';
import { listVoices } from '../tts/library.js';

/**
 * Xem lại kết quả từng bước trong tab Xem trước + chọn giọng theo người nói (Tan 2026-10-10): dữ liệu chỉ đọc
 * từ file của video; đổi giọng ghi cấu hình `voice.id` (người dẫn, tầng video) hoặc `voice_id` của nhân vật.
 */

const readJson = <T>(f: string): T | undefined => {
  try {
    return JSON.parse(readFileSync(f, 'utf8')) as T;
  } catch {
    return undefined;
  }
};

export interface SpeakerVoice {
  /** `narrator` hoặc `ca_…`. */
  speaker: string;
  name: string;
  lines: number;
  voice_id: string | null;
  voice_name?: string;
}

export interface ChannelVoice {
  voice_id: string;
  name: string;
  /** Ngôn ngữ của giọng (`en`, `vi`…), rỗng nếu không ghi. */
  language: string;
  kind: 'cloned' | 'designed';
  ready: boolean;
  /** Câu mẫu (`voices/<vo>/ref.wav`) để nghe thử, đường dẫn tuyệt đối. */
  ref?: string;
  used_by: string[];
}

/** Người nói trong kịch bản (người dẫn + nhân vật) kèm giọng đang dùng; giọng ref của kênh để chọn. */
export function videoVoices(
  store: WriteStore,
  videoId: string,
  appDataDir?: string,
): { language: string; speakers: SpeakerVoice[]; voices: ChannelVoice[] } {
  const model = loadVideoModel(store.root, videoId, appDataDir);
  const lib = listVoices(store.root, videoId, appDataDir);
  const name = new Map(lib.voices.map((v) => [v.voice_id, v.name]));
  const counts = new Map<string, number>();
  for (const l of model.lines) counts.set(l.speaker, (counts.get(l.speaker) ?? 0) + 1);
  if (!counts.size) counts.set('narrator', 0);
  const speakers = [...counts].map(([speaker, lines]): SpeakerVoice => {
    const voice =
      speaker === 'narrator'
        ? lib.narrator_voice_id
        : ((model.cast[speaker]?.voice_id as string | undefined) ?? null);
    return {
      speaker,
      name: speaker === 'narrator' ? 'Người dẫn' : (model.cast[speaker]?.name ?? speaker),
      lines,
      voice_id: voice,
      ...(voice && name.get(voice) ? { voice_name: name.get(voice)! } : {}),
    };
  });
  const voices = lib.voices.map((v): ChannelVoice => ({
    voice_id: v.voice_id,
    name: v.name,
    language: v.language,
    kind: v.kind,
    ready: v.ready,
    used_by: v.used_by,
    ...(existsSync(path.join(store.root, 'voices', v.voice_id, 'ref.wav'))
      ? { ref: path.join(store.root, 'voices', v.voice_id, 'ref.wav') }
      : {}),
  }));
  return { language: model.language ?? '', speakers, voices };
}

/**
 * Đổi giọng một người nói: người dẫn → `voice.id` tầng video; nhân vật → `voice_id` trong `CAST.md` của video
 * (không có thì `characters/<ca>/cast.json` của kênh). Audio các line của người đó lỗi thời → chạy lại Giọng đọc.
 */
export function assignVoice(
  store: WriteStore,
  videoId: string,
  speaker: string,
  voiceId: string,
  /** Người dẫn: `channel` = giọng mặc định của kênh (mọi video sau), bỏ ghi đè riêng của video này. */
  scope: 'video' | 'channel' = 'video',
): void {
  if (!/^vo_[0-9a-z]{8}$/.test(voiceId) || !existsSync(path.join(store.root, 'voices', voiceId)))
    throw new SfError('E_ID_UNKNOWN', `voice ${voiceId} is not in this channel`);
  if (speaker === 'narrator') {
    if (scope === 'channel') {
      setConfig(store, 'voice.id', voiceId, { tier: 'channel' });
      const rel = `videos/${videoId}/state.json`;
      const st = readJson<{ config_overrides?: Record<string, unknown> }>(store.abs(rel));
      if (st?.config_overrides && 'voice.id' in st.config_overrides) {
        delete st.config_overrides['voice.id'];
        store.write(rel, `${JSON.stringify(st, null, 2)}\n`, { by: 'voice.assign' });
      }
    } else setConfig(store, 'voice.id', voiceId, { tier: 'video', videoId });
    return;
  }
  const castRel = `videos/${videoId}/CAST.md`;
  if (existsSync(store.abs(castRel))) {
    const doc = parseBlocksDoc(readFileSync(store.abs(castRel), 'utf8'));
    const blk = doc.blocks.find((b) => b.tag === 'sf-cast');
    const list = Array.isArray(blk?.data) ? (blk!.data as Record<string, unknown>[]) : [];
    const hit = list.find((c) => c?.id === speaker);
    if (blk && hit) {
      blk.data = list.map((c) => (c === hit ? { ...c, voice_id: voiceId } : c));
      store.write(castRel, serializeBlocksDoc(doc), { by: 'voice.assign' });
      return;
    }
  }
  const rel = `characters/${speaker}/cast.json`;
  const c = readJson<Record<string, unknown>>(store.abs(rel));
  if (!c) throw new SfError('E_ID_UNKNOWN', `speaker ${speaker} has no cast entry`);
  store.write(rel, `${JSON.stringify({ ...c, voice_id: voiceId }, null, 2)}\n`, {
    by: 'voice.assign',
    validate: false,
  });
}

/**
 * Nghe thử cả lời đọc: ghép audio các line theo thứ tự (kèm khoảng lặng `pause_after_ms`) thành
 * `.sf/preview/narration-<hash>.wav` (dẫn xuất, dựng lại khi audio đổi). Trả đường dẫn tuyệt đối.
 */
export async function narrationPreview(store: WriteStore, videoId: string): Promise<string> {
  const v = `videos/${videoId}`;
  const meta = readJson<AudioMeta>(store.abs(`${v}/audio_meta.json`));
  const model = loadVideoModel(store.root, videoId);
  const pause = new Map(model.lines.map((l) => [l.id, l.pause_after_ms ?? 0]));
  const parts = (meta?.lines ?? [])
    .map((l) => ({
      abs: store.abs(`${v}/${l.file}`),
      pause: pause.get(l.line_id) ?? 0,
      h: l.content_hash,
    }))
    .filter((x) => existsSync(x.abs));
  if (!parts.length)
    throw new SfError('E_FILE_NOT_FOUND', 'no line audio yet — run Giọng đọc first');
  const key = sha256(parts.map((p) => `${p.h}:${p.pause}`).join('|')).slice(0, 12);
  const rel = `${v}/.sf/preview/narration-${key}.wav`;
  if (existsSync(store.abs(rel))) return store.abs(rel);
  const scratch = createScratchDir();
  try {
    const out = path.join(scratch.dir, 'narration.wav');
    const inputs = parts.flatMap((p) => ['-i', p.abs]);
    const chain = parts
      .map(
        (p, i) =>
          `[${i}:a]aresample=48000,aformat=channel_layouts=mono${p.pause ? `,apad=pad_dur=${(p.pause / 1000).toFixed(3)}` : ''}[a${i}]`,
      )
      .join(';');
    const concat = `${parts.map((_, i) => `[a${i}]`).join('')}concat=n=${parts.length}:v=0:a=1[out]`;
    await runFfmpeg([
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      ...inputs,
      '-filter_complex',
      `${chain};${concat}`,
      '-map',
      '[out]',
      '-c:a',
      'pcm_s16le',
      out,
    ]);
    store.importFile(out, rel, { by: 'voice.preview' });
    return store.abs(rel);
  } finally {
    scratch.cleanup();
  }
}

export interface ReviewShot {
  frame_id: string;
  scene: string;
  layout?: string;
  motion?: string;
  texts: string[];
  /** Ảnh của cảnh (đường dẫn tuyệt đối; chỉ ảnh đã có). */
  images: string[];
  /** Ảnh đang chờ sinh (prompt). */
  pending_prompts: string[];
  /** Lớp ảnh đã có (cùng thứ tự `images`): ID lớp + tạo lại được không (ảnh sinh, không phải thư viện). */
  image_layers: { layer_id: string; file: string; regenerable: boolean }[];
  line_ids: string[];
  duration_ms?: number;
}

export interface ReviewData {
  /** Khung dọc (shorts) → ảnh cảnh hiển thị dọc. */
  vertical: boolean;
  script: {
    beats: { id: string; title: string }[];
    lines: {
      id: string;
      beat_id: string;
      speaker: string;
      speaker_name: string;
      text: string;
      audio?: string;
      duration_ms?: number;
    }[];
  };
  shots: ReviewShot[];
  music: { scene: string; track?: string; query?: string; none: boolean }[];
  /** Ảnh chụp các frame (contact sheet) sau bước Dựng hình. */
  snapshots: string[];
  draft?: { file: string; duration_ms?: number; finished_at: string };
  release?: { file: string; duration_ms?: number; finished_at: string };
}

/** Kết quả từng bước để xem lại (chỉ đọc; phần nào chưa có thì rỗng). */
export function reviewData(store: WriteStore, videoId: string, appDataDir?: string): ReviewData {
  const v = `videos/${videoId}`;
  const vdir = store.abs(v);
  const model = loadVideoModel(store.root, videoId, appDataDir);
  const meta = readJson<AudioMeta>(path.join(vdir, 'audio_meta.json'));
  const audio = new Map((meta?.lines ?? []).map((l) => [l.line_id, l]));
  const scriptText = existsSync(path.join(vdir, 'SCRIPT.md'))
    ? readFileSync(path.join(vdir, 'SCRIPT.md'), 'utf8')
    : '';
  const beats = [...scriptText.matchAll(/^##\s+(.+?)\s*<!--\s*sf:beat id=(bt_[0-9a-z]{8})/gm)].map(
    (m) => ({ id: m[2]!, title: m[1]!.trim() }),
  );
  const lines = model.lines.map((l) => {
    const a = audio.get(l.id);
    const abs = a ? path.join(vdir, a.file) : undefined;
    return {
      id: l.id,
      beat_id: l.beat_id,
      speaker: l.speaker,
      speaker_name:
        l.speaker === 'narrator' ? 'Người dẫn' : (model.cast[l.speaker]?.name ?? l.speaker),
      text: l.text,
      ...(abs && existsSync(abs) ? { audio: abs, duration_ms: a!.duration_ms } : {}),
    };
  });
  const lib = new Map(
    (
      readJson<{ assets: { id: string; file: string }[] }>(
        path.join(store.root, 'assets', 'manifest.json'),
      )?.assets ?? []
    ).map((a) => [a.id, a.file]),
  );
  const graph = readJson<{
    nodes: Record<
      string,
      { meta?: { asset_id?: string; frames?: { id: string; duration_ms: number }[] } }
    >;
  }>(path.join(vdir, '.sf', 'graph.json'));
  const timing = new Map(
    (graph?.nodes['frame_timing']?.meta?.frames ?? []).map((f) => [f.id, f.duration_ms]),
  );
  const generated = (layer: string) => graph?.nodes[`asset:${layer}`]?.meta?.asset_id;
  const imageOf = (assetId: string | undefined): string | undefined => {
    if (!assetId) return undefined;
    const staged = readdirSafe(path.join(vdir, 'public')).find((f) => f.startsWith(`${assetId}.`));
    if (staged) return path.join(vdir, 'public', staged);
    const f = lib.get(assetId);
    return f && existsSync(path.join(store.root, f)) ? path.join(store.root, f) : undefined;
  };
  const sceneTitle = new Map(model.scenes.map((s) => [s.id, s.title]));
  const shots = model.frames.map((f): ReviewShot => {
    const fx = f as typeof f & { layout?: string; motion?: string };
    const visual = f.layers.filter((l) => ['background', 'image', 'object'].includes(l.kind));
    return {
      frame_id: f.id,
      scene: sceneTitle.get(f.scene_id) ?? '',
      ...(fx.layout ? { layout: fx.layout } : {}),
      ...(fx.motion ? { motion: fx.motion } : {}),
      texts: f.layers.filter((l) => l.kind === 'text' && l.text).map((l) => l.text!),
      images: visual
        .map((l) => imageOf((l.asset_id as string | undefined) ?? generated(l.id)))
        .filter((x): x is string => Boolean(x)),
      image_layers: visual.flatMap((l) => {
        const file = imageOf((l.asset_id as string | undefined) ?? generated(l.id));
        return file
          ? [
              {
                layer_id: l.id as string,
                file,
                regenerable: !l.asset_id && l.asset_request?.source === 'generate',
              },
            ]
          : [];
      }),
      pending_prompts: visual
        .filter((l) => !l.asset_id && !generated(l.id) && l.asset_request?.prompt)
        .map((l) => l.asset_request!.prompt!),
      line_ids: f.line_ids,
      ...(timing.get(f.id) ? { duration_ms: timing.get(f.id)! } : {}),
    };
  });
  const music = model.scenes.map((s) => {
    const m = s.music;
    return {
      scene: s.title,
      none: m === 'none' || !m,
      ...(m && m !== 'none' && m.track_id ? { track: m.track_id } : {}),
      ...(m && m !== 'none' && m.query ? { query: m.query } : {}),
    };
  });
  const snapDir = path.join(vdir, '.sf', 'snapshots');
  const snapshots = readdirSafe(snapDir)
    .filter((f) => /\.(jpe?g|png)$/i.test(f))
    .sort()
    .map((f) => path.join(snapDir, f));
  const renders = listRenders(store.root, videoId);
  const pick = (mode: string) => {
    const r = renders.find((x) => x.mode === mode);
    return r
      ? {
          file: r.file,
          finished_at: r.finished_at,
          ...(r.duration_ms ? { duration_ms: r.duration_ms } : {}),
        }
      : undefined;
  };
  const draft = pick('draft');
  const release = pick('release');
  let vertical = false;
  try {
    const p = loadOutputProfile(
      resolveConfig<string | null>(
        'output.profile',
        { channelDir: store.root, videoId },
        { appDataDir },
      ).value,
    );
    vertical = p.height > p.width;
  } catch {
    /* profile chưa cài */
  }
  return {
    vertical,
    script: { beats, lines },
    shots,
    music,
    snapshots,
    ...(draft ? { draft } : {}),
    ...(release ? { release } : {}),
  };
}

function readdirSafe(d: string): string[] {
  try {
    return existsSync(d) ? readdirSync(d) : [];
  } catch {
    return [];
  }
}

/** Cấu hình người dẫn có giọng chưa (để UI nhắc chọn). */
export const narratorVoice = (store: WriteStore, videoId: string, appDataDir?: string) =>
  resolveConfig<string | null>('voice.id', { channelDir: store.root, videoId }, { appDataDir })
    .value ?? null;

/**
 * Giọng khác ngôn ngữ video (vd. giọng tiếng Việt đọc kịch bản tiếng Anh — Tan 2026-10-10): trả mô tả lỗi kèm
 * giọng đúng ngôn ngữ có sẵn của kênh; rỗng = ổn. Giọng không ghi ngôn ngữ thì bỏ qua.
 */
export function voiceLanguageProblems(
  store: WriteStore,
  videoId: string,
  appDataDir?: string,
): string[] {
  const model = loadVideoModel(store.root, videoId, appDataDir);
  const lang = (model.language ?? '').toLowerCase().slice(0, 2);
  if (!lang) return [];
  const lib = listVoices(store.root, videoId, appDataDir);
  const byId = new Map(lib.voices.map((v) => [v.voice_id, v]));
  const ok = lib.voices.filter((v) => v.ready && v.language.toLowerCase().startsWith(lang));
  const { speakers } = videoVoices(store, videoId, appDataDir);
  const out: string[] = [];
  for (const sp of speakers) {
    const v = sp.voice_id ? byId.get(sp.voice_id) : undefined;
    const vl = v?.language?.toLowerCase().slice(0, 2);
    if (!v || !vl || vl === lang) continue;
    out.push(
      `${sp.name} đang dùng giọng "${v.name}" (${vl}) nhưng video nói ${lang}` +
        (ok.length
          ? ` — chọn giọng ${lang} có sẵn: ${ok.map((x) => `"${x.name}" (${x.voice_id})`).join(', ')}`
          : ` — kênh chưa có giọng ${lang}, nhờ agent tạo giọng`),
    );
  }
  return out;
}
