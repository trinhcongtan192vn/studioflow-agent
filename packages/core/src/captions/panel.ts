import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { AudioMeta, CaptionGroups, CaptionOverrides, VideoState } from '../contracts/types.js';
import { sha256 } from '../domain/hash.js';
import { SfError } from '../errors.js';
import type { Gateway } from '../gateway/gateway.js';
import type { SessionContext } from '../contracts/types.js';
import {
  captionViolations,
  effectiveCaptions,
  lineWordsOf,
  type EffectiveGroup,
} from '../hf/captions-html.js';
import type { WriteStore } from '../store/writer.js';
import { ensurePreviewVoice, previewVoiceRel, type Waveform } from './voice.js';

export interface CaptionsPanelData {
  /** Cụm sau khi áp override (mốc theo chuỗi lời đọc = mốc trên `voice.wav`). */
  groups: EffectiveGroup[];
  base_groups: CaptionGroups['groups'];
  overrides: CaptionOverrides;
  /** Hash `caption-overrides.json` hiện tại (null: chưa có) — gửi lại làm `base_hash` khi lưu. */
  base_hash: string | null;
  lines: {
    line_id: string;
    start_ms: number;
    duration_ms: number;
    words: { text: string; start_ms: number; end_ms: number }[];
  }[];
  /** Đường dẫn tuyệt đối của `voice.wav` (renderer phát qua giao thức `sf-media:`). */
  audio: string | null;
  waveform: Pick<Waveform, 'step_ms' | 'duration_ms' | 'peaks'> | null;
  /** `owner = studio` → bảng caption chỉ đọc (D9 6). */
  read_only: boolean;
  orphans: string[];
}

const emptyOverrides = (videoId: string): CaptionOverrides =>
  ({
    schema_version: 1,
    video_id: videoId,
    groups: {},
    splits: [],
    merges: [],
  }) as unknown as CaptionOverrides;

function readJson<T>(store: WriteStore, rel: string): T | null {
  const f = store.abs(rel);
  return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as T) : null;
}

/**
 * Bảng caption (D9 6, FR-ST-05, 026): đọc cụm + override + audio xem trước; ghi duy nhất
 * `caption-overrides.json` qua `artifact.write` có `base_hash` (Gateway kiểm schema, owner, hash).
 */
export class CaptionPanel {
  constructor(private readonly gateway: Gateway) {}

  load(store: WriteStore, videoId: string): CaptionsPanelData {
    const v = `videos/${videoId}`;
    const cg = readJson<CaptionGroups>(store, `${v}/caption_groups.json`);
    if (!cg)
      throw new SfError('E_STEP_INCOMPLETE', 'caption_groups.json is missing; align audio first');
    const meta = readJson<AudioMeta>(store, `${v}/audio_meta.json`);
    const ovAbs = store.abs(`${v}/caption-overrides.json`);
    const raw = existsSync(ovAbs) ? readFileSync(ovAbs, 'utf8') : null;
    const overrides = raw
      ? ({ splits: [], merges: [], groups: {}, ...JSON.parse(raw) } as CaptionOverrides)
      : emptyOverrides(videoId);
    const eff = effectiveCaptions(cg, overrides, lineWordsOf(meta));
    const st = readJson<VideoState>(store, `${v}/state.json`);
    const wave = meta?.lines.length ? ensurePreviewVoice(store, videoId, meta) : null;
    return {
      groups: eff.groups,
      base_groups: cg.groups,
      overrides,
      base_hash: raw === null ? null : sha256(raw),
      lines: (meta?.lines ?? []).map((l) => ({
        line_id: l.line_id,
        start_ms: l.start_ms,
        duration_ms: l.duration_ms,
        words: l.words.map((w) => ({ text: w.text, start_ms: w.start_ms, end_ms: w.end_ms })),
      })),
      audio: wave ? path.normalize(store.abs(previewVoiceRel(videoId))) : null,
      waveform: wave
        ? { step_ms: wave.step_ms, duration_ms: wave.duration_ms, peaks: wave.peaks }
        : null,
      read_only: st?.owner === 'studio',
      orphans: eff.orphans,
    };
  }

  /** Lưu override: kiểm bất biến (D9 6) rồi ghi qua Gateway với `base_hash`. */
  async save(
    store: WriteStore,
    videoId: string,
    overrides: CaptionOverrides,
    baseHash: string | null,
  ): Promise<{ hash: string; groups: EffectiveGroup[] }> {
    const v = `videos/${videoId}`;
    const cg = readJson<CaptionGroups>(store, `${v}/caption_groups.json`);
    const meta = readJson<AudioMeta>(store, `${v}/audio_meta.json`);
    if (!cg || !meta)
      throw new SfError('E_STEP_INCOMPLETE', 'caption_groups.json/audio_meta.json is missing');
    const doc = {
      ...overrides,
      schema_version: 1,
      video_id: videoId,
    } as CaptionOverrides;
    const eff = effectiveCaptions(cg, doc, lineWordsOf(meta));
    const bad = [
      ...captionViolations(eff.groups, meta),
      ...eff.orphans
        .filter((o) => o.startsWith('split:') || o.startsWith('merge:'))
        .map((o) => `${o} cannot be applied`),
    ];
    if (bad.length) throw new SfError('E_SCHEMA_INVALID', `caption overrides: ${bad.join('; ')}`);
    const ovRel = `${v}/caption-overrides.json`;
    if (baseHash === null && existsSync(store.abs(ovRel)))
      throw new SfError(
        'E_BASE_HASH_MISMATCH',
        'caption-overrides.json was created since it was read; reload it',
      );
    const content = `${JSON.stringify(doc, null, 2)}\n`;
    const ctx = {
      session_id: 'ss_ui000001',
      kind: 'main',
      channel_dir: store.root,
      video_id: videoId,
    } as SessionContext;
    const r = await this.gateway.call(ctx, 'artifact.write', {
      path: 'caption-overrides.json',
      content,
      ...(baseHash ? { base_hash: baseHash } : {}),
    });
    if (!r.ok) throw new SfError(r.error.code, r.error.message);
    return { hash: sha256(content), groups: eff.groups };
  }
}
