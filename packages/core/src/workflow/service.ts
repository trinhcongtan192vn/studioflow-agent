import type { ProviderRegistry } from '../capability/registry.js';
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
    const r = await graph.build(ctx.videoId, { targets, signal: ctx.signal });
    if (r.status !== 'succeeded') {
      const bad = Object.entries(r.nodes).filter(([, n]) => n.status === 'failed');
      throw new SfError(
        'E_PROVIDER_FAILED',
        bad.map(([id, n]) => `${id}: ${n.error?.message}`).join('; ') || 'voice build failed',
      );
    }
    return { outputs: ['audio_meta.json'] };
  };
}
