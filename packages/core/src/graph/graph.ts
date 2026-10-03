import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { AudioMeta, Line, NodeStatus, PlanEstimate, PlannedJob } from '../contracts/types.js';
import { canonicalJson, sha256 } from '../domain/hash.js';
import { readAsrState } from '../asr/state.js';
import { SfError } from '../errors.js';
import type { WriteStore } from '../store/writer.js';
import { loadVideoModel, voiceOf, type VideoModel } from './model.js';
import {
  assembleAudioLines,
  computeFrameTiming,
  type FrameTiming,
  type FrameTimingInput,
} from './timing.js';

export type NodeType =
  'audio.line' | 'asr.line' | 'audio_meta' | 'captions' | 'frame_timing' | 'index';
export type Phase = 'tts' | 'asr' | 'image' | 'lipsync' | 'assemble';
export type NodeState = 'fresh' | 'stale' | 'missing' | 'pinned' | 'pinned_stale' | 'failed';

const PHASES: Phase[] = ['tts', 'asr', 'image', 'lipsync', 'assemble'];
const PHASE_OF: Record<NodeType, Phase> = {
  'audio.line': 'tts',
  'asr.line': 'asr',
  audio_meta: 'assemble',
  captions: 'assemble',
  frame_timing: 'assemble',
  index: 'assemble',
};
const ASSEMBLE_ORDER: NodeType[] = ['audio_meta', 'captions', 'frame_timing', 'index'];

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
  parts: unknown;
  line?: Line;
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

/** Kết quả builder: file đầu ra (tương đối video) và/hoặc meta (lưu trong graph.json). */
export interface BuildOutput {
  outputs?: string[];
  meta?: unknown;
}

export type Builder = (ctx: BuilderContext) => Promise<BuildOutput>;

/** Builder theo loại nút; tính năng sau đăng ký (006 audio.line, 010 asr.line/captions, 011 index). */
export class BuilderRegistry {
  private readonly builders = new Map<NodeType, Builder>();

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
            tts_text: l.tts_text ?? null,
            emotion: l.emotion ?? null,
            speaker: l.speaker,
            voice_id: voice,
            voice_files: voice ? model.hashChannelDir(`voices/${voice}`) : null,
            provider: model.config('provider.tts.synthesize'),
            language: model.language,
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
    let frameHtml: string[] = [];
    const framesDir = path.join(model.videoDir, 'compositions', 'frames');
    if (existsSync(framesDir))
      frameHtml = readdirSync(framesDir)
        .sort()
        .map((f) => `${f}:${model.hashOf(`compositions/frames/${f}`)}`);
    add('index', ['frame_timing', 'captions'], {
      frames_html: frameHtml,
      overrides: model.hashOf('caption-overrides.json'),
      // 011: nền từ frame.md, kích thước theo output profile, transition vào của frame
      frame_md: model.hashOf('frame.md'),
      profile: model.config('output.profile'),
      transitions: model.frames.map((f) => f.transition_in ?? null),
      // 012: nhạc theo scene + mức trộn
      music: model.scenes.map((s) => [
        s.id,
        s.music ?? null,
        model.config('music.volume_db', { sceneId: s.id }),
      ]),
      duck_db: model.config('music.duck_db'),
    });
    return defs.sort(
      (a, b) =>
        PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase) ||
        (a.phase === 'assemble'
          ? ASSEMBLE_ORDER.indexOf(a.type) - ASSEMBLE_ORDER.indexOf(b.type)
          : 0),
    );
  }

  private inputHash(def: NodeDef, records: Record<string, NodeRecord>): string {
    return sha256(
      canonicalJson({
        type: def.type,
        parts: def.parts,
        deps: def.deps.map((d) => records[d]?.output_hash ?? null),
      }),
    );
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
    for (const d of defs) {
      const rec = g.nodes[d.id];
      const ih = this.inputHash(d, g.nodes);
      let s: NodeState;
      if (!rec) s = 'missing';
      else if (rec.status === 'failed') s = rec.input_hash === ih ? 'failed' : 'stale';
      else if (!this.outputsExist(model.videoId, rec)) s = 'missing';
      else if (rec.input_hash !== ih) s = 'stale';
      else if (d.deps.some((dep) => status.get(dep) !== 'fresh')) s = 'stale';
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
    return this.nodeStates(videoId).map((n) => ({ key: n.id, type: n.type, status: n.status }));
  }

  /** `graph.plan` — `{jobs: PlannedJob[], estimate: PlanEstimate}` của D4 mục 3.1. */
  plan(videoId: string, targets?: string[]): { jobs: PlannedJob[]; estimate: PlanEstimate } {
    const internal = this.planNodes(videoId, targets);
    const avg = this.historyMs(videoId);
    const jobs: PlannedJob[] = internal.jobs.map((j) => ({
      kind: j.type,
      targets: [j.node],
      phase: PHASES.indexOf(j.phase),
      est_ms: Math.round(avg.get(j.type) ?? 0),
      est_cost_usd: 0,
      from_cache: false,
    }));
    return {
      jobs,
      estimate: {
        total_ms: jobs.reduce((s, j) => s + j.est_ms, 0),
        total_cost_usd: 0,
        jobs_count: jobs.length,
        cached_count: 0,
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
    const jobs = defs
      .filter((d) => status.get(d.id) !== 'fresh' && (!wanted || wanted.has(d.id)))
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

  /** `graph.build`: chạy kế hoạch; khóa theo video (hai lần build cùng video chạy nối tiếp). */
  async build(
    videoId: string,
    opts: {
      targets?: string[];
      signal?: AbortSignal;
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
