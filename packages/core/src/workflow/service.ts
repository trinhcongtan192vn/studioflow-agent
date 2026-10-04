import { alignVideo } from '../asr/regen.js';
import type { ProviderRegistry } from '../capability/registry.js';
import type { AgentRuntime } from '../contracts/types.js';
import { resolveConfig } from '../config/resolve.js';
import { SfError } from '../errors.js';
import type { PermissionBus } from '../gateway/permission.js';
import { BuildGraph, type BuilderRegistry } from '../graph/graph.js';
import type { WriteStore } from '../store/writer.js';
import { WorkflowEngine, type AgentStepRunner, type StepExecutor } from './engine.js';
import { loadPacks, type WorkflowPack } from './packs.js';

/** Dịch vụ workflow của `core`: gói, executor theo `uses`, runner bước agent, engine theo video. */
export class WorkflowService {
  private readonly executors = new Map<string, StepExecutor>();
  private readonly engines = new Map<string, WorkflowEngine>();
  private runner?: AgentStepRunner;
  private cache?: WorkflowPack[];

  constructor(
    private readonly d: {
      dirs: string[];
      providers: ProviderRegistry;
      builders: BuilderRegistry;
      storeFor: (dir: string) => WriteStore;
      permissions?: PermissionBus;
      appDataDir?: string;
    },
  ) {
    this.registerExecutor('voice', voiceExecutor(d.builders, d.permissions));
  }

  /** Mọi gói (cả không tương thích, có `errors`). */
  packs(): WorkflowPack[] {
    this.cache ??= loadPacks(this.d.dirs, this.d.providers);
    return this.cache;
  }

  /** Nạp lại gói (sau khi cài/gỡ). */
  reload(): void {
    this.cache = undefined;
  }

  registerExecutor(uses: string, fn: StepExecutor): void {
    this.executors.set(uses, fn);
  }

  executor(uses: string): StepExecutor | undefined {
    return this.executors.get(uses);
  }

  unregisterExecutor(uses: string): void {
    this.executors.delete(uses);
  }

  setAgentRunner(fn: AgentStepRunner | undefined): void {
    this.runner = fn;
  }

  /** Runtime agent cho phiên `frame` của bước frame-build (011); desktop/CLI gắn khi có. */
  agentRuntime?: AgentRuntime;

  setAgentRuntime(rt: AgentRuntime | undefined): void {
    this.agentRuntime = rt;
  }

  /** Bộ dựng lại frame cho nút `frame_html` (020 R1): executor frame-build cho một frame, trong graph. */
  rebuildFrame = async (i: {
    store: WriteStore;
    videoId: string;
    frameId: string;
    signal: AbortSignal;
  }): Promise<void> => {
    const exec = this.executors.get('frame-build');
    if (!exec) throw new SfError('E_STEP_INCOMPLETE', 'frame-build executor is not registered');
    const ctx = this.engine(i.store.root, i.videoId).frameBuildContext(i.signal);
    await exec({ ...ctx, only: [i.frameId], inGraph: true } as typeof ctx);
  };

  engine(channelDir: string, videoId: string): WorkflowEngine {
    const store = this.d.storeFor(channelDir);
    const key = `${store.root}|${videoId}`;
    let e = this.engines.get(key);
    if (!e) {
      e = new WorkflowEngine({
        store,
        videoId,
        packs: () => this.packs(),
        executors: this.executors,
        agentRunner: () => this.runner,
        builders: this.d.builders,
        appDataDir: this.d.appDataDir,
      });
      this.engines.set(key, e);
    }
    return e;
  }
}

/** Executor bước `voice` (D6 mục 2): `graph.build` các nút `audio.line` (+ `asr.line` khi có) và `audio_meta`. */
function voiceExecutor(builders: BuilderRegistry, permissions?: PermissionBus): StepExecutor {
  return async (ctx) => {
    const graph = new BuildGraph({ store: ctx.store, appDataDir: ctx.appDataDir, builders });
    const targets = ['audio.line', 'asr.line', 'audio_meta'];
    const lines = graph
      .planNodes(ctx.videoId, targets)
      .jobs.filter((j) => j.type === 'audio.line').length;
    const limit = Number(
      resolveConfig(
        'policy.batch.tts_lines',
        { channelDir: ctx.channelDir, videoId: ctx.videoId },
        { appDataDir: ctx.appDataDir },
      ).value,
    );
    if (lines > limit && permissions) {
      const ok = await permissions.ask(
        {
          session_id: 'ss_workflow',
          kind: 'main',
          channel_dir: ctx.channelDir,
          video_id: ctx.videoId as never,
        },
        {
          tool: 'workflow',
          kind: 'batch_gen',
          summary: `Bước ${ctx.step.id}: sinh ${lines} line audio (ngưỡng ${limit})`,
        },
      );
      if (!ok)
        throw new SfError('E_PERMISSION_DECLINED', `user declined generating ${lines} lines`);
    }
    // TTS → ASR (sinh lại line đọc sai) → audio_meta → captions (010)
    const r = builders.active('asr.line')
      ? await alignVideo({ store: ctx.store, builders, appDataDir: ctx.appDataDir }, ctx.videoId, {
          signal: ctx.signal,
        })
      : { ...(await graph.build(ctx.videoId, { targets, signal: ctx.signal })), mismatched: [] };
    if (r.status !== 'succeeded') {
      const bad = Object.entries(r.nodes).filter(([, n]) => n.status === 'failed');
      throw new SfError(
        'E_PROVIDER_FAILED',
        bad.map(([id, n]) => `${id}: ${n.error?.message}`).join('; ') || 'voice build failed',
      );
    }
    return {
      outputs: ['audio_meta.json', ...(builders.active('captions') ? ['caption_groups.json'] : [])],
      ...(r.mismatched.length
        ? {
            summary: `ASR: ${r.mismatched.length} line còn lệch sau khi sinh lại (${r.mismatched
              .map((m) => `${m.line_id} WER ${m.asr_wer.toFixed(2)}`)
              .join(', ')}) — nghe lại, sửa chữ hoặc chấp nhận (asr.accept).`,
          }
        : {}),
    };
  };
}
