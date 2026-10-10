import { spokenText } from '../tts/spoken.js';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { GSAP_LOCAL } from '../hf/gsap.js';
import type {
  AudioMeta,
  CaptionGroups,
  CaptionOverrides,
  Frame,
  Line,
  NodeStatus,
  PlanEstimate,
  PlannedJob,
} from '../contracts/types.js';
import { canonicalJson, sha256 } from '../domain/hash.js';
import { readAsrState } from '../asr/state.js';
import { SfError } from '../errors.js';
import type { WriteStore } from '../store/writer.js';
import { loadOutputProfile } from '../hf/outputs.js';
import { effectiveCaptions, lineWordsOf } from '../hf/captions-html.js';
import { frameLook } from '../finish/grading.js';
import { overlayBlocksHash } from '../finish/overlays.js';
import { loadVideoModel, voiceOf, type VideoModel } from './model.js';
import {
  assembleAudioLines,
  computeFrameTiming,
  type FrameTiming,
  type FrameTimingInput,
} from './timing.js';

export type NodeType =
  | 'audio.line'
  | 'asr.line'
  | 'audio_meta'
  | 'captions'
  | 'frame_timing'
  | 'asset'
  | 'lipsync.line'
  | 'frame_html'
  | 'index'
  | 'credits'
  | 'render';
export type Phase = 'tts' | 'asr' | 'image' | 'lipsync' | 'assemble';
export type NodeState =
  'fresh' | 'stale' | 'missing' | 'pinned' | 'pinned_stale' | 'failed' | 'external_change';

const PHASES: Phase[] = ['tts', 'asr', 'image', 'lipsync', 'assemble'];
const PHASE_OF: Record<NodeType, Phase> = {
  'audio.line': 'tts',
  'asr.line': 'asr',
  audio_meta: 'assemble',
  captions: 'assemble',
  frame_timing: 'assemble',
  asset: 'image',
  'lipsync.line': 'lipsync',
  frame_html: 'assemble',
  index: 'assemble',
  credits: 'assemble',
  render: 'assemble',
};
const ASSEMBLE_ORDER: NodeType[] = [
  'audio_meta',
  'captions',
  'frame_timing',
  'frame_html',
  'index',
  'credits',
  'render',
];
/** Hash ref audio cảm xúc của nhân vật cho line (`CastMember.emotions`, 031); không có → undefined. */
function emotionRef(model: VideoModel, l: Line): string | undefined {
  if (!l.emotion || l.speaker === 'narrator') return undefined;
  const ref = model.cast[l.speaker]?.emotions?.[l.emotion];
  if (!ref) return undefined;
  const f = path.join(model.channelDir, ...ref.split('/'));
  return existsSync(f) ? sha256(readFileSync(f)) : `missing:${ref}`;
}

/** Line cần khẩu hình (032): frame có `lipsync` và `lipsync.enabled` ở tầng frame; line của `cast_id`. */
export function lipsyncLines(model: VideoModel): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of model.frames) {
    if (!f.lipsync?.cast_id) continue;
    if (model.config('lipsync.enabled', { sceneId: f.scene_id, frameId: f.id }) !== true) continue;
    for (const id of f.line_ids)
      if (model.lines.find((l) => l.id === id)?.speaker === f.lipsync.cast_id)
        out.set(id, f.lipsync.cast_id);
  }
  return out;
}

function profileFps(model: VideoModel): number {
  try {
    return loadOutputProfile(model.config('output.profile')).fps;
  } catch {
    return 30;
  }
}

/** Frame không gồm phần hoàn thiện (look, hiệu ứng, overlay — 027). */
export function contentOf(f: Frame): Frame {
  const { effects: _e, overlays: _o, ...rest } = f;
  void _e;
  void _o;
  if (!rest.config || !('look.id' in rest.config)) return rest;
  const { ['look.id']: _l, ...cfg } = rest.config;
  void _l;
  if (Object.keys(cfg).length) return { ...rest, config: cfg };
  const { config: _c, ...r } = rest;
  void _c;
  return r;
}

/** Phần hoàn thiện của frame trong hash `frame_html` (027); không grade, không hiệu ứng → không có. */
export function finishPart(model: VideoModel, f: Frame, appDataDir?: string) {
  const look = frameLook(model, f, appDataDir);
  // 032: khẩu hình (cue của line nhân vật trong frame) là phần hoàn thiện — không gọi lại agent
  const ls = lipsyncLines(model);
  const lipsync = f.line_ids.some((id) => ls.has(id))
    ? {
        anchor: f.lipsync?.mouth_anchor ?? null,
        mouth_set: (f.lipsync && model.cast[f.lipsync.cast_id]?.mouth_set) ?? null,
        cues: f.line_ids.filter((id) => ls.has(id)).map((id) => model.hashOf(`lipsync/${id}.json`)),
      }
    : undefined;
  if (!look.grading && !f.effects?.length && !lipsync) return undefined;
  return { look, effects: f.effects ?? [], ...(lipsync ? { lipsync } : {}) };
}

/** Hash đầu vào của nút bỏ phần hoàn thiện — builder `frame_html` biết chỉ cần áp lại look (027). */
export function contentInputHash(def: NodeDef, records: Record<string, NodeRecord>): string {
  const all =
    typeof def.parts === 'function'
      ? ((def.parts as (r: typeof records) => Record<string, unknown>)(records) ?? {})
      : ((def.parts ?? {}) as Record<string, unknown>);
  const { finish: _f, ...parts } = all;
  void _f;
  return sha256(
    canonicalJson({
      type: def.type,
      parts,
      deps: (def.hashDeps ?? def.deps).map((d) => records[d]?.output_hash ?? null),
    }),
  );
}

/** Nút chỉ chạy khi được chọn làm mục tiêu (020 R4). */
const EXPLICIT_ONLY = new Set<NodeType>(['render']);

/**
 * Nút chưa "xong" cho gate `graph_fresh`: không fresh/ghim; nút chỉ-khi-chọn (render) không tính (020);
 * override caption `orphan` chỉ để báo người dùng, không phải nút build (D3 5.8, 026).
 */
export function unsettled(n: { type: string; status: string }): boolean {
  return (
    n.status !== 'fresh' &&
    n.status !== 'pinned' &&
    n.status !== 'orphan' &&
    !EXPLICIT_ONLY.has(n.type as NodeType)
  );
}

/** Kích thước ảnh theo `asset_request.aspect` (FN-018/023, 020 US1). */
const ASPECT_SIZE: Record<string, [number, number]> = {
  '16:9': [1664, 928],
  '9:16': [928, 1664],
  '1:1': [1328, 1328],
  '4:3': [1472, 1104],
};

/** Seed cố định theo scene (FN-023, 020 R3). */
export const sceneSeed = (sceneId: string): number =>
  parseInt(sha256(sceneId).slice(0, 8), 16) % 2 ** 31;

/** Bản ghi một nút trong `.sf/graph.json` (D4 mục 8.2). */
export interface NodeRecord {
  key: string;
  type: NodeType;
  input_hash: string;
  output_hash: string | null;
  status: 'fresh' | 'failed';
  updated_at: string;
  outputs?: string[];
  ms?: number;
  meta?: unknown;
  error?: { message: string };
}

interface GraphFile {
  schema_version: 1;
  nodes: Record<string, NodeRecord>;
}

export interface NodeDef {
  id: string;
  type: NodeType;
  key: string;
  phase: Phase;
  deps: string[];
  /** Phần đầu vào; hàm → tính theo bản ghi hiện tại (ví dụ thời gian làm tròn của frame). */
  parts: unknown | ((records: Record<string, NodeRecord>) => unknown);
  /** Phụ thuộc đưa vào hash (mặc định mọi `deps`); `frame_html` chỉ băm asset (020 R1). */
  hashDeps?: string[];
  /** Phụ thuộc lan trạng thái lỗi thời khi lập kế hoạch (mặc định mọi `deps`). */
  staleDeps?: string[];
  line?: Line;
  /** `asset`: layer + scene/frame chứa nó. */
  layer?: {
    id: string;
    frame_id: string;
    scene_id: string;
    request: NonNullable<Frame['layers'][number]['asset_request']>;
  };
}

/** Trạng thái nút dạng nội bộ (có id/pha) — dùng cho build và test chi tiết. */
export interface NodeState_ {
  id: string;
  type: NodeType;
  key: string;
  status: NodeState;
}

/** Mục kế hoạch dạng nội bộ. */
export interface PlannedNode {
  node: string;
  type: NodeType;
  key: string;
  phase: Phase;
}

export interface BuilderContext {
  /** Định nghĩa nút (layer của `asset`, …). */
  def?: NodeDef;
  store: WriteStore;
  channelDir: string;
  videoId: string;
  /** `videos/<vd>` — tiền tố để ghi qua store. */
  videoRel: string;
  nodeId: string;
  type: NodeType;
  key: string;
  inputHash: string;
  line?: Line;
  model: VideoModel;
  /** Bản ghi hiện tại của mọi nút (meta của nút phụ thuộc). */
  records: Record<string, NodeRecord>;
  signal: AbortSignal;
}

/** Ước tính cho `graph.plan` (D4 mục 3.1, 020 R5). */
export interface PlanInfo {
  engine?: string;
  from_cache?: boolean;
  cost_usd?: number;
}
export type Planner = (ctx: { store: WriteStore; model: VideoModel; def: NodeDef }) => PlanInfo;

/** Kết quả builder: file đầu ra (tương đối video) và/hoặc meta (lưu trong graph.json). */
export interface BuildOutput {
  outputs?: string[];
  meta?: unknown;
}

export type Builder = (ctx: BuilderContext) => Promise<BuildOutput>;

/** Builder theo loại nút; tính năng sau đăng ký (006 audio.line, 010 asr.line/captions, 011 index). */
export class BuilderRegistry {
  private readonly builders = new Map<NodeType, Builder>();
  private readonly planners = new Map<NodeType, Planner>();

  registerPlanner(type: NodeType, fn: Planner): void {
    this.planners.set(type, fn);
  }

  planner(type: NodeType): Planner | undefined {
    return this.planners.get(type);
  }

  constructor() {
    this.builders.set('audio_meta', buildAudioMeta);
    this.builders.set('frame_timing', buildFrameTiming);
  }

  registerBuilder(type: NodeType, fn: Builder): void {
    this.builders.set(type, fn);
  }

  get(type: NodeType): Builder | undefined {
    return this.builders.get(type);
  }

  active(type: NodeType): boolean {
    return this.builders.has(type);
  }
}

export interface BuildResult {
  status: 'succeeded' | 'partial' | 'failed';
  nodes: Record<
    string,
    { status: 'built' | 'fresh' | 'failed' | 'skipped'; error?: { message: string } }
  >;
}

/** Build graph của một video (D4 mục 8): định nghĩa nút, trạng thái, kế hoạch, build. */
export class BuildGraph {
  private readonly builders: BuilderRegistry;
  private static readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    private readonly opts: { store: WriteStore; appDataDir?: string; builders?: BuilderRegistry },
  ) {
    this.builders = opts.builders ?? new BuilderRegistry();
  }

  registerBuilder(type: NodeType, fn: Builder): void {
    this.builders.registerBuilder(type, fn);
  }

  registerPlanner(type: NodeType, fn: Planner): void {
    this.builders.registerPlanner(type, fn);
  }

  private get store(): WriteStore {
    return this.opts.store;
  }

  private graphRel(videoId: string): string {
    return `videos/${videoId}/.sf/graph.json`;
  }

  private load(videoId: string): GraphFile {
    const p = this.store.abs(this.graphRel(videoId));
    if (!existsSync(p)) return { schema_version: 1, nodes: {} };
    try {
      const g = JSON.parse(readFileSync(p, 'utf8')) as GraphFile;
      return g && typeof g.nodes === 'object' ? g : { schema_version: 1, nodes: {} };
    } catch {
      return { schema_version: 1, nodes: {} }; // dẫn xuất: hỏng → dựng lại
    }
  }

  private save(videoId: string, g: GraphFile): void {
    this.store.write(this.graphRel(videoId), `${JSON.stringify(g, null, 2)}\n`, {
      by: 'graph.build',
      validate: false,
    });
  }

  /** Định nghĩa nút theo D4 mục 8.1 (chỉ loại đã có builder). */
  nodes(model: VideoModel): NodeDef[] {
    const on = (t: NodeType) => this.builders.active(t);
    const defs: NodeDef[] = [];
    const asr = readAsrState(model.videoDir);
    if (on('audio.line')) {
      for (const l of model.lines) {
        const voice = voiceOf(model, l);
        defs.push({
          id: `audio.line:${l.id}`,
          type: 'audio.line',
          key: l.id,
          phase: 'tts',
          deps: [],
          line: l,
          parts: {
            text: l.text,
            // chữ thật sự đọc (sf:tts gộp câu khác → bỏ, vd_bjoza2qu)
            // (giữ nguyên giá trị cũ khi hợp lệ → hash không đổi, chỉ line lỗi đọc lại)
            tts_text:
              l.tts_text !== undefined && spokenText(l, model.lines) === l.tts_text.trim()
                ? l.tts_text
                : null,
            emotion: l.emotion ?? null,
            speaker: l.speaker,
            voice_id: voice,
            voice_files: voice ? model.hashChannelDir(`voices/${voice}`) : null,
            // 031: giọng theo cảm xúc của nhân vật → ref audio của cảm xúc (chỉ khi có, giữ hash cũ)
            ...(emotionRef(model, l) ? { emotion_ref: emotionRef(model, l) } : {}),
            provider: model.config('provider.tts.synthesize'),
            language: model.language,
            // nhịp đọc của design kênh (1 = giữ hash cũ)
            ...(model.voiceSpeed !== 1 ? { speed: model.voiceSpeed } : {}),
            // sinh lại do ASR lệch (010 R3) → seed khác
            ...(asr.regen[l.id] ? { regen: asr.regen[l.id] } : {}),
          },
        });
      }
    }
    if (on('asr.line')) {
      for (const l of model.lines) {
        defs.push({
          id: `asr.line:${l.id}`,
          type: 'asr.line',
          key: l.id,
          phase: 'asr',
          deps: on('audio.line') ? [`audio.line:${l.id}`] : [],
          line: l,
          parts: { text: l.text },
        });
      }
    }
    const lineDeps = defs.map((d) => d.id);
    // 032: khẩu hình mức 1 cho line của nhân vật trong frame bật lip-sync (D4 8.1 `lipsync.line`)
    if (on('lipsync.line')) {
      for (const [lineId, castId] of lipsyncLines(model)) {
        defs.push({
          id: `lipsync.line:${lineId}`,
          type: 'lipsync.line',
          key: lineId,
          phase: 'lipsync',
          deps: on('audio.line') ? [`audio.line:${lineId}`] : [],
          line: model.lines.find((l) => l.id === lineId)!,
          parts: {
            cast_id: castId,
            fps: profileFps(model),
            provider: model.config('provider.lipsync.cues'),
          },
        });
      }
    }
    const add = (type: NodeType, deps: string[], parts: unknown) =>
      on(type) &&
      defs.push({
        id: type,
        type,
        key: '',
        phase: PHASE_OF[type],
        deps: deps.filter((d) => defs.some((x) => x.id === d)),
        parts,
      });
    add('audio_meta', lineDeps, {
      order: model.lines.map((l) => l.id),
      pauses: model.lines.map((l) => l.pause_after_ms ?? 0),
      ...(Object.keys(asr.accepted).length ? { accepted: asr.accepted } : {}),
    });
    add('captions', ['audio_meta'], {
      texts: model.lines.map((l) => [l.id, l.text]),
      style: model.config('caption.style'),
      max_words: model.config('caption.max_words'),
    });
    add('frame_timing', ['audio_meta'], { frames: frameTimingInputs(model) });
    // 020: ảnh sinh cho layer `asset_request.source = generate` chưa có asset_id
    if (on('asset')) {
      // 037: hash chỉ của ảnh được tham chiếu (manifest kênh) — không phải cả thư mục assets/,
      // vì mỗi ảnh mới sinh làm đổi thư mục và mọi ảnh có tham chiếu sẽ luôn bị coi là lỗi thời
      const lib = new Map(
        (
          (existsSync(path.join(this.store.root, 'assets', 'manifest.json'))
            ? JSON.parse(
                readFileSync(path.join(this.store.root, 'assets', 'manifest.json'), 'utf8'),
              )
            : { assets: [] }) as { assets: { id: string; hash?: string }[] }
        ).assets.map((a) => [a.id, a.hash ?? null]),
      );
      for (const f of model.frames)
        for (const l of f.layers) {
          const req = l.asset_request;
          if (l.asset_id || req?.source !== 'generate') continue;
          const [w, h] = req.aspect
            ? ASPECT_SIZE[req.aspect]!
            : req.transparent
              ? [1024, 1024]
              : ASPECT_SIZE['16:9']!;
          defs.push({
            id: `asset:${l.id}`,
            type: 'asset',
            key: l.id,
            phase: 'image',
            deps: [],
            layer: { id: l.id, frame_id: f.id, scene_id: f.scene_id, request: req },
            parts: {
              prompt: req.prompt ?? l.notes ?? '',
              refs: req.reference_asset_ids ?? [],
              refs_hash: req.reference_asset_ids?.length
                ? req.reference_asset_ids.map((id) => lib.get(id) ?? null)
                : null,
              transparent: Boolean(req.transparent),
              // 2026-10-10: công thức ảnh trong suốt (Qwen RGBA, prompt không tả nền) → ảnh cũ dính nền sinh lại
              ...(req.transparent ? { alpha: 2 } : {}),
              size: [w, h],
              look: model.config('look.id', { sceneId: f.scene_id, frameId: f.id }),
              provider: model.config('provider.image.generate'),
              // storyboard có khóa dùng chung (`bg:`/`img:`/`actor:` — đạo diễn 2026-10-10): cùng prompt + tham
              // chiếu → cùng seed → sinh một lần cho cả video; storyboard cũ giữ seed theo scene (không sinh lại)
              seed: /^\s*(actor|bg|img):/i.test(l.notes ?? '')
                ? sceneSeed(`${req.prompt ?? ''}|${(req.reference_asset_ids ?? []).join(',')}`)
                : sceneSeed(f.scene_id),
            },
          });
        }
    }
    // 020: frame do phiên agent `frame` dựng; đầu vào làm tròn theo video frame (D4 8.3)
    const frameNodes: string[] = [];
    if (on('frame_html')) {
      let fps = 30;
      try {
        fps = loadOutputProfile(model.config('output.profile') as string | null).fps;
      } catch {
        /* profile chưa cài → 30 */
      }
      const toFrames = (ms: number) => Math.round((ms * fps) / 1000);
      const frameMd = model.hashOf('frame.md');
      for (const [fi, f] of model.frames.entries()) {
        const next = model.frames[fi + 1];
        const lineNodes = f.line_ids.flatMap((ln) =>
          defs
            .filter((d) => d.id === `audio.line:${ln}` || d.id === `asr.line:${ln}`)
            .map((d) => d.id),
        );
        const assets = f.layers
          .filter((l) => defs.some((d) => d.id === `asset:${l.id}`))
          .map((l) => `asset:${l.id}`);
        const id = `frame_html:${f.id}`;
        frameNodes.push(id);
        defs.push({
          id,
          type: 'frame_html',
          key: f.id,
          phase: 'assemble',
          deps: [
            'frame_timing',
            ...assets,
            ...f.line_ids
              .map((ln) => `lipsync.line:${ln}`)
              .filter((id) => defs.some((d) => d.id === id)),
          ],
          hashDeps: assets,
          // thời lượng frame chỉ đổi khi line của chính nó đổi (D4 8.3); mốc tuyệt đối do index đặt
          staleDeps: [...assets, ...lineNodes],
          parts: (records: Record<string, NodeRecord>) => {
            const t = records['frame_timing']?.meta as FrameTiming | undefined;
            const ft = t?.frames.find((x) => x.id === f.id);
            // 027: look/hiệu ứng (hoàn thiện) tách khỏi nội dung — đổi chỉ hoàn thiện thì không gọi agent;
            // overlay thuộc nút index
            const finish = finishPart(model, f, this.opts.appDataDir);
            return {
              frame: contentOf(f),
              ...(finish ? { finish } : {}),
              lines: model.lines
                .filter((l) => f.line_ids.includes(l.id))
                .map((l) => [l.id, l.text]),
              duration: ft ? toFrames(ft.duration_ms) : null,
              // transition vào của frame sau chồng lên cuối frame này (giữ khung cuối)
              next_transition: next?.transition_in ?? null,
              line_timing: (t?.lines ?? [])
                .filter((l) => l.frame_id === f.id)
                .map((l) => [
                  l.id,
                  toFrames(l.start_ms - (ft?.start_ms ?? 0)),
                  toFrames(l.duration_ms),
                ]),
              frame_md: frameMd,
              profile: model.config('output.profile'),
            };
          },
        });
      }
    }
    const framesDir = path.join(model.videoDir, 'compositions', 'frames');
    // 046: băm file frame lúc băm nút (sau khi nút frame_html trong cùng lần build ghi lại frame),
    // không lúc bắt đầu build — nếu không index luôn "stale" ngay sau build
    const frameHtml = () =>
      existsSync(framesDir)
        ? readdirSync(framesDir)
            .sort()
            .map((f) => `${f}:${model.hashOf(`compositions/frames/${f}`)}`)
        : [];
    add('index', ['frame_timing', 'captions', ...frameNodes], () => ({
      frames_html: frameHtml(),
      overrides: model.hashOf('caption-overrides.json'),
      // 027: overlay theo frame + mẫu khối đang dùng (chỉ khi có — giữ hash dự án cũ)
      ...(model.frames.some((f) => f.overlays?.length)
        ? {
            overlays: model.frames.filter((f) => f.overlays?.length).map((f) => [f.id, f.overlays]),
            overlay_blocks: overlayBlocksHash(model, this.opts.appDataDir),
          }
        : {}),
      // 011: nền từ frame.md, kích thước theo output profile, transition vào của frame
      frame_md: model.hashOf('frame.md'),
      profile: model.config('output.profile'),
      transitions: model.frames.map((f) => f.transition_in ?? null),
      // 012: nhạc theo scene + mức trộn
      // 092: `advanced.music` tắt → scene có bài coi như `none` (video không có nhạc chỉ đổi băm khi có bài)
      music: model.scenes.map((s) => [
        s.id,
        model.config('advanced.music') === false &&
        s.music &&
        s.music !== 'none' &&
        s.music.track_id
          ? 'none'
          : (s.music ?? null),
        model.config('music.volume_db', { sceneId: s.id }),
      ]),
      duck_db: model.config('music.duck_db'),
      // 2026-10-10: hiệu ứng âm thanh của frame (chỉ khi có — giữ hash dự án cũ)
      ...(model.frames.some((f) => f.sfx?.length)
        ? { sfx: model.frames.filter((f) => f.sfx?.length).map((f) => [f.id, f.sfx]) }
        : {}),
      // 059: GSAP cục bộ — đổi bản ghim (hay chuyển từ CDN) → lắp lại index một lần
      gsap: GSAP_LOCAL,
    }));
    // 020: CREDITS từ nhạc + asset đã dùng; render nháp (chỉ khi được chọn)
    // đọc lúc băm (asset vừa sinh trong cùng lần build làm đổi thư mục assets)
    add('credits', ['index', ...frameNodes], () => ({ assets: model.hashChannelDir('assets') }));
    add('render', ['index', 'credits'], { profile: model.config('output.profile') });
    return defs.sort(
      (a, b) =>
        PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase) ||
        (a.phase === 'assemble'
          ? ASSEMBLE_ORDER.indexOf(a.type) - ASSEMBLE_ORDER.indexOf(b.type)
          : 0),
    );
  }

  private inputHash(def: NodeDef, records: Record<string, NodeRecord>): string {
    const parts =
      typeof def.parts === 'function'
        ? (def.parts as (r: typeof records) => unknown)(records)
        : def.parts;
    return sha256(
      canonicalJson({
        type: def.type,
        parts,
        deps: (def.hashDeps ?? def.deps).map((d) => records[d]?.output_hash ?? null),
      }),
    );
  }

  /** File của video bị sửa ngoài app, app chưa ghi lại (`.sf/external.json`, 025). */
  private externalFiles(model: VideoModel): Set<string> {
    const f = path.join(model.videoDir, '.sf', 'external.json');
    if (!existsSync(f)) return new Set();
    try {
      return new Set(
        Object.keys((JSON.parse(readFileSync(f, 'utf8')) as { files?: object }).files ?? {}),
      );
    } catch {
      return new Set();
    }
  }

  /** `state.json.pinned_frames` (D3 5.5) — frame có chỉnh tay. */
  private pinnedFrames(model: VideoModel): Set<string> {
    const f = path.join(model.videoDir, 'state.json');
    if (!existsSync(f)) return new Set();
    try {
      return new Set(
        Object.keys(
          (JSON.parse(readFileSync(f, 'utf8')) as { pinned_frames?: object }).pinned_frames ?? {},
        ),
      );
    } catch {
      return new Set();
    }
  }

  private outputsExist(videoId: string, rec: NodeRecord): boolean {
    return (rec.outputs ?? []).every((o) => existsSync(this.store.abs(`videos/${videoId}/${o}`)));
  }

  private evaluate(
    model: VideoModel,
    g: GraphFile,
  ): { defs: NodeDef[]; status: Map<string, NodeState> } {
    const defs = this.nodes(model);
    const status = new Map<string, NodeState>();
    const pinned = this.pinnedFrames(model);
    const ext = this.externalFiles(model);
    const ok = (x: NodeState | undefined) =>
      x === 'fresh' || x === 'pinned' || x === 'pinned_stale' || x === 'external_change';
    for (const d of defs) {
      const rec = g.nodes[d.id];
      const ih = this.inputHash(d, g.nodes);
      let s: NodeState;
      // D9 mục 5: frame chỉnh tay — giữ nguyên; đầu vào đổi từ lúc ghim → cần người dùng quyết định
      if (d.type === 'frame_html' && pinned.has(d.key))
        s = rec?.input_hash === ih ? 'pinned' : 'pinned_stale';
      // FR-WS-06: đầu ra bị sửa ngoài app → không tự ghi đè (D9 3.6)
      else if (rec?.outputs?.some((o) => ext.has(o))) s = 'external_change';
      else if (!rec) s = 'missing';
      else if (rec.status === 'failed') s = rec.input_hash === ih ? 'failed' : 'stale';
      else if (!this.outputsExist(model.videoId, rec)) s = 'missing';
      else if (rec.input_hash !== ih) s = 'stale';
      else if ((d.staleDeps ?? d.deps).some((dep) => !ok(status.get(dep)))) s = 'stale';
      else s = 'fresh';
      status.set(d.id, s);
    }
    return { defs, status };
  }

  private model(videoId: string): VideoModel {
    return loadVideoModel(this.store.root, videoId, this.opts.appDataDir);
  }

  /** Trạng thái từng nút (dạng nội bộ). */
  nodeStates(videoId: string): NodeState_[] {
    const { defs, status } = this.evaluate(this.model(videoId), this.load(videoId));
    return defs.map((d) => ({ id: d.id, type: d.type, key: d.key, status: status.get(d.id)! }));
  }

  /** `graph.status` — `NodeStatus` của D4 mục 3.1 (`key` = id nút, ví dụ `audio.line:ln_…`). */
  status(videoId: string): NodeStatus[] {
    return [...this.nodeStatus(videoId), ...this.captionOrphans(videoId)];
  }

  /** Override caption trỏ tới group đã biến mất → `orphan` (D3 5.8, 026). */
  private captionOrphans(videoId: string): NodeStatus[] {
    const v = path.join(this.store.root, 'videos', videoId);
    const read = <T>(f: string): T | null => {
      try {
        return existsSync(path.join(v, f))
          ? (JSON.parse(readFileSync(path.join(v, f), 'utf8')) as T)
          : null;
      } catch {
        return null;
      }
    };
    const ov = read<CaptionOverrides>('caption-overrides.json');
    const cg = read<CaptionGroups>('caption_groups.json');
    if (!ov || !cg) return [];
    return effectiveCaptions(cg, ov, lineWordsOf(read<AudioMeta>('audio_meta.json'))).orphans.map(
      (o) => ({
        key: `caption_override:${o}`,
        type: 'caption_override',
        status: 'orphan',
        reason: 'caption override refers to a caption group that no longer exists (D3 5.8)',
      }),
    );
  }

  private nodeStatus(videoId: string): NodeStatus[] {
    return this.nodeStates(videoId).map((n) => ({
      key: n.id,
      type: n.type,
      status: n.status,
      ...(n.status === 'pinned_stale'
        ? {
            decision_required: true,
            reason: 'frame was edited by hand and its inputs changed (D9 section 5)',
          }
        : n.status === 'external_change'
          ? { decision_required: true, reason: 'output was changed outside the app (FR-WS-06)' }
          : {}),
    }));
  }

  /** `graph.plan` — `{jobs: PlannedJob[], estimate: PlanEstimate}` của D4 mục 3.1. */
  plan(videoId: string, targets?: string[]): { jobs: PlannedJob[]; estimate: PlanEstimate } {
    const internal = this.planNodes(videoId, targets);
    const avg = this.historyMs(videoId);
    const model = this.model(videoId);
    const defs = new Map(this.nodes(model).map((d) => [d.id, d]));
    const jobs: PlannedJob[] = internal.jobs.map((j) => {
      const fn = this.builders.planner(j.type);
      const info: PlanInfo = fn ? fn({ store: this.store, model, def: defs.get(j.node)! }) : {};
      return {
        kind: j.type,
        targets: [j.node],
        ...(info.engine ? { engine: info.engine } : {}),
        phase: PHASES.indexOf(j.phase),
        est_ms: info.from_cache ? 0 : Math.round(avg.get(j.type) ?? 0),
        est_cost_usd: info.from_cache ? 0 : (info.cost_usd ?? 0),
        from_cache: Boolean(info.from_cache),
      };
    });
    return {
      jobs,
      estimate: {
        total_ms: jobs.reduce((s, j) => s + j.est_ms, 0),
        total_cost_usd: Math.round(jobs.reduce((s, j) => s + j.est_cost_usd, 0) * 1e6) / 1e6,
        jobs_count: jobs.length,
        cached_count: jobs.filter((j) => j.from_cache).length,
      },
    };
  }

  private historyMs(videoId: string): Map<NodeType, number> {
    const history = new Map<NodeType, number[]>();
    for (const r of Object.values(this.load(videoId).nodes))
      if (r.ms !== undefined) history.set(r.type, [...(history.get(r.type) ?? []), r.ms]);
    return new Map([...history].map(([t, h]) => [t, h.reduce((a, b) => a + b, 0) / h.length]));
  }

  /** Nút không `fresh` theo pha (dạng nội bộ); ước tính giây từ lịch sử (D4 mục 8.3). */
  planNodes(
    videoId: string,
    targets?: string[],
  ): { jobs: PlannedNode[]; estimate: { seconds: number | null; cost_usd: number } } {
    const g = this.load(videoId);
    const { defs, status } = this.evaluate(this.model(videoId), g);
    const wanted = targets?.length ? closure(defs, targets) : undefined;
    const skip = new Set<NodeState>(['fresh', 'pinned', 'pinned_stale', 'external_change']);
    const jobs = defs
      .filter(
        (d) =>
          !skip.has(status.get(d.id)!) && (wanted ? wanted.has(d.id) : !EXPLICIT_ONLY.has(d.type)),
      )
      .map((d) => ({ node: d.id, type: d.type, key: d.key, phase: d.phase }));
    const history = new Map<NodeType, number[]>();
    for (const r of Object.values(g.nodes))
      if (r.ms !== undefined) history.set(r.type, [...(history.get(r.type) ?? []), r.ms]);
    let seconds: number | null = null;
    for (const j of jobs) {
      const h = history.get(j.type);
      if (h?.length) seconds = (seconds ?? 0) + h.reduce((a, b) => a + b, 0) / h.length / 1000;
    }
    return { jobs, estimate: { seconds, cost_usd: 0 } };
  }

  /** D9 mục 5 "Giữ bản chỉnh tay": cập nhật `input_hash` của frame ghim → `pinned`. */
  acceptPinned(videoId: string, frameId: string): void {
    const g = this.load(videoId);
    const def = this.nodes(this.model(videoId)).find((d) => d.id === `frame_html:${frameId}`);
    if (!def) throw new SfError('E_ID_UNKNOWN', `frame ${frameId} has no frame_html node`);
    const rec = g.nodes[def.id];
    const outputs = [`compositions/frames/${frameId}.html`];
    g.nodes[def.id] = {
      key: def.key,
      type: def.type,
      input_hash: this.inputHash(def, g.nodes),
      output_hash: rec?.output_hash ?? this.outputHash(videoId, outputs, undefined),
      status: 'fresh',
      updated_at: new Date().toISOString(),
      outputs,
    };
    this.save(videoId, g);
  }

  /** Ghi nhận nút đã được dựng ngoài `graph.build` (bước frame-build của workflow, 020 R1). */
  markBuilt(videoId: string, nodeIds: string[], opts: { contentOnly?: boolean } = {}): void {
    const g = this.load(videoId);
    const defs = new Map(this.nodes(this.model(videoId)).map((d) => [d.id, d]));
    for (const id of nodeIds) {
      const def = defs.get(id);
      if (!def) continue;
      const outputs = def.type === 'frame_html' ? [`compositions/frames/${def.key}.html`] : [];
      if (!outputs.every((o) => existsSync(this.store.abs(`videos/${videoId}/${o}`)))) continue;
      // contentOnly (027): frame vừa do agent dựng, chưa hoàn thiện → lần build sau chỉ áp look/hiệu ứng
      const content = opts.contentOnly ? contentInputHash(def, g.nodes) : undefined;
      g.nodes[id] = {
        key: def.key,
        type: def.type,
        input_hash: content ?? this.inputHash(def, g.nodes),
        ...(content ? { meta: { content_hash: content } } : {}),
        output_hash: this.outputHash(videoId, outputs, undefined),
        status: 'fresh',
        updated_at: new Date().toISOString(),
        outputs,
      };
    }
    this.save(videoId, g);
  }

  private outputHash(videoId: string, outputs: string[], meta: unknown): string {
    return sha256(
      [
        ...outputs.map(
          (o) => `${o}:${sha256(readFileSync(this.store.abs(`videos/${videoId}/${o}`)))}`,
        ),
        canonicalJson(meta ?? null),
      ].join('\n'),
    );
  }

  /** `graph.build`: chạy kế hoạch; khóa theo video (hai lần build cùng video chạy nối tiếp). */
  async build(
    videoId: string,
    opts: {
      targets?: string[];
      signal?: AbortSignal;
      /** Tạm dừng mềm: không bắt đầu nút mới (nút đang chạy chạy xong, kết quả được lưu). */
      stop?: AbortSignal;
      progress?: (done: number, total: number, message?: string) => void;
    } = {},
  ): Promise<BuildResult> {
    const lockKey = `${this.store.root}|${videoId}`;
    const prev = BuildGraph.locks.get(lockKey) ?? Promise.resolve();
    const run = prev.catch(() => {}).then(() => this.buildNow(videoId, opts));
    BuildGraph.locks.set(lockKey, run);
    try {
      return await run;
    } finally {
      if (BuildGraph.locks.get(lockKey) === run) BuildGraph.locks.delete(lockKey);
    }
  }

  private async buildNow(
    videoId: string,
    opts: {
      targets?: string[];
      signal?: AbortSignal;
      /** Tạm dừng mềm: không bắt đầu nút mới (nút đang chạy chạy xong, kết quả được lưu). */
      stop?: AbortSignal;
      progress?: (done: number, total: number, message?: string) => void;
    },
  ): Promise<BuildResult> {
    const signal = opts.signal ?? new AbortController().signal;
    const g = this.load(videoId);
    const model = this.model(videoId);
    const plan = this.planNodes(videoId, opts.targets).jobs;
    const defs = new Map(this.nodes(model).map((d) => [d.id, d]));
    const result: BuildResult = { status: 'succeeded', nodes: {} };
    let done = 0;
    for (const p of plan) {
      if (signal.aborted) throw new SfError('E_JOB_CANCELED', 'canceled');
      if (opts.stop?.aborted) throw new SfError('E_JOB_CANCELED', PAUSED);
      const def = defs.get(p.node)!;
      opts.progress?.(done, plan.length, p.node);
      const blocked = def.deps.some((d) => {
        const r = result.nodes[d];
        return (
          (r && (r.status === 'failed' || r.status === 'skipped')) ||
          (!r && g.nodes[d]?.status !== 'fresh')
        );
      });
      if (blocked) {
        result.nodes[def.id] = { status: 'skipped' };
        done++;
        continue;
      }
      const ih = this.inputHash(def, g.nodes);
      const rec = g.nodes[def.id];
      if (
        rec &&
        rec.status === 'fresh' &&
        rec.input_hash === ih &&
        this.outputsExist(videoId, rec)
      ) {
        result.nodes[def.id] = { status: 'fresh' };
        done++;
        continue;
      }
      const t0 = Date.now();
      try {
        const out = await this.builders.get(def.type)!({
          store: this.store,
          channelDir: this.store.root,
          videoId,
          videoRel: `videos/${videoId}`,
          nodeId: def.id,
          def,
          type: def.type,
          key: def.key,
          inputHash: ih,
          line: def.line,
          model,
          records: g.nodes,
          signal,
        });
        const outputs = out.outputs ?? [];
        // hash đầu ra = file + meta: meta đổi mà file giữ nguyên vẫn lan tới nút sau (010)
        const outputHash = sha256(
          [
            ...outputs.map(
              (o) => `${o}:${sha256(readFileSync(this.store.abs(`videos/${videoId}/${o}`)))}`,
            ),
            canonicalJson(out.meta ?? null),
          ].join('\n'),
        );
        g.nodes[def.id] = {
          key: def.key,
          type: def.type,
          input_hash: ih,
          output_hash: outputHash,
          status: 'fresh',
          updated_at: new Date().toISOString(),
          outputs,
          ms: Date.now() - t0,
          ...(out.meta === undefined ? {} : { meta: out.meta }),
        };
        result.nodes[def.id] = { status: 'built' };
      } catch (e) {
        if (signal.aborted) throw e;
        const message = String((e as Error)?.message ?? e).split('\n')[0]!;
        g.nodes[def.id] = {
          key: def.key,
          type: def.type,
          input_hash: ih,
          output_hash: null,
          status: 'failed',
          updated_at: new Date().toISOString(),
          error: { message },
        };
        result.nodes[def.id] = { status: 'failed', error: { message } };
      }
      this.save(videoId, g);
      done++;
    }
    opts.progress?.(done, plan.length);
    const bad = Object.values(result.nodes).filter(
      (n) => n.status === 'failed' || n.status === 'skipped',
    ).length;
    const total = Object.keys(result.nodes).length;
    result.status = bad === 0 ? 'succeeded' : bad === total ? 'failed' : 'partial';
    return result;
  }
}

/** Thông điệp của lần build dừng do tạm dừng mềm (`stop`). */
export const PAUSED = 'paused after the current item';

function closure(defs: NodeDef[], targets: string[]): Set<string> {
  const byId = new Map(defs.map((d) => [d.id, d]));
  const out = new Set<string>();
  const visit = (id: string) => {
    if (out.has(id)) return;
    out.add(id);
    byId.get(id)?.deps.forEach(visit);
  };
  for (const t of targets)
    for (const d of defs) if (d.id === t || d.id.startsWith(`${t}:`) || d.type === t) visit(d.id);
  return out;
}

function frameTimingInputs(model: VideoModel): FrameTimingInput[] {
  return model.frames.map((f) => ({
    id: f.id,
    line_ids: f.line_ids ?? [],
    min_duration_ms: Number(model.config('frame.min_duration_ms', { frameId: f.id })),
    ...(f.min_duration_ms === undefined ? {} : { frame_min_duration_ms: f.min_duration_ms }),
    ...(f.transition_in ? { transition_in: f.transition_in } : {}),
  }));
}

interface AudioLineMeta {
  duration_ms: number;
  voice_id: string;
  file: string;
  content_hash: string;
}

/** Builder `audio_meta` (D3 5.7): lắp từ meta của `audio.line` và `asr.line`. */
const buildAudioMeta: Builder = async (ctx) => {
  const lines = ctx.model.lines;
  const accepted = readAsrState(ctx.model.videoDir).accepted;
  const assembled = assembleAudioLines(
    lines.map((l) => {
      const m = ctx.records[`audio.line:${l.id}`]?.meta as AudioLineMeta | undefined;
      if (!m) throw new Error(`no audio for line ${l.id}`);
      return { line_id: l.id, duration_ms: m.duration_ms, pause_after_ms: l.pause_after_ms };
    }),
  );
  const meta: AudioMeta = {
    schema_version: 1,
    video_id: ctx.videoId as AudioMeta['video_id'],
    sample_rate: 48000,
    lines: lines.map((l, i) => {
      const a = ctx.records[`audio.line:${l.id}`]!.meta as AudioLineMeta;
      const asr = ctx.records[`asr.line:${l.id}`]?.meta as
        | {
            words: AudioMeta['lines'][number]['words'];
            asr_wer?: number;
            asr_flag?: 'ok' | 'mismatch' | 'accepted';
          }
        | undefined;
      return {
        line_id: l.id,
        file: a.file,
        start_ms: assembled.lines[i]!.start_ms,
        duration_ms: a.duration_ms,
        speaker: l.speaker,
        voice_id: a.voice_id as AudioMeta['lines'][number]['voice_id'],
        words: asr?.words ?? [],
        ...(asr?.asr_wer === undefined ? {} : { asr_wer: asr.asr_wer }),
        ...(asr?.asr_flag === undefined
          ? {}
          : {
              asr_flag:
                asr.asr_flag === 'mismatch' && accepted[l.id] === a.content_hash
                  ? ('accepted' as const)
                  : asr.asr_flag,
            }),
        content_hash: a.content_hash,
      };
    }),
    total_duration_ms: assembled.total_duration_ms,
  };
  ctx.store.write(`${ctx.videoRel}/audio_meta.json`, `${JSON.stringify(meta, null, 2)}\n`, {
    by: 'graph.build',
  });
  return { outputs: ['audio_meta.json'] };
};

/** Builder `frame_timing` (D4 mục 8.3): kết quả lưu trong graph.json. */
const buildFrameTiming: Builder = async (ctx) => {
  const meta = JSON.parse(
    readFileSync(ctx.store.abs(`${ctx.videoRel}/audio_meta.json`), 'utf8'),
  ) as AudioMeta;
  const pauses = new Map(ctx.model.lines.map((l) => [l.id as string, l.pause_after_ms ?? 0]));
  const durations = Object.fromEntries(
    meta.lines.map((l) => [
      l.line_id,
      { duration_ms: l.duration_ms, pause_after_ms: pauses.get(l.line_id) },
    ]),
  );
  const timing: FrameTiming = computeFrameTiming(frameTimingInputs(ctx.model), durations);
  return { meta: timing };
};
