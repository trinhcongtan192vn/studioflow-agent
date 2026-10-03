import { existsSync, readFileSync } from 'node:fs';
import { sessionOptionsFor } from '../agent/options.js';
import type { AgentRuntime, FramePacket, SessionContext } from '../contracts/types.js';
import { resolveConfig } from '../config/resolve.js';
import { canonicalJson, sha256 } from '../domain/hash.js';
import { newId } from '../domain/ids.js';
import { SfError } from '../errors.js';
import type { Gateway } from '../gateway/gateway.js';
import { BuildGraph, type BuilderRegistry } from '../graph/graph.js';
import { loadVideoModel } from '../graph/model.js';
import type { FrameTiming } from '../graph/timing.js';
import { Logger } from '../log.js';
import type { WriteStore } from '../store/writer.js';
import type { StepRunContext } from '../workflow/engine.js';
import { hfCheck, hfLint } from './cli.js';
import { checkFrameFile } from './frame-file.js';
import { ensureHfProject } from './index-builder.js';
import { buildFramePacket, frameInstruction, stageFrameAssets } from './packet.js';

export interface FrameBuildDeps {
  builders: BuilderRegistry;
  gateway: Gateway;
  runtime: () => AgentRuntime | undefined;
  /** Chạy `hyperframes check` (Chrome headless) sau lint; mặc định có. */
  check?: boolean;
  logger?: Logger;
}

interface FramesState {
  schema_version: 1;
  frames: Record<string, { packet_hash: string; built_at: string; new_element_ids?: string[] }>;
}

const statePath = (videoId: string) => `videos/${videoId}/.sf/frames.json`;

function readFramesState(store: WriteStore, videoId: string): FramesState {
  const f = store.abs(statePath(videoId));
  try {
    return existsSync(f)
      ? (JSON.parse(readFileSync(f, 'utf8')) as FramesState)
      : { schema_version: 1, frames: {} };
  } catch {
    return { schema_version: 1, frames: {} };
  }
}

/** Giới hạn song song đơn giản. */
async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(n, queue.length)) }, async () => {
      for (let x = queue.shift(); x !== undefined; x = queue.shift()) await fn(x);
    }),
  );
}

export interface FrameBuildResult {
  outputs: string[];
  built: string[];
  skipped: string[];
  summary?: string;
}

/**
 * Executor bước `frame-build` (D6 mục 2, 011 FR-004): mỗi frame một phiên `frame` (song song
 * `frame_build.parallel`), chờ `workflow.step_complete(frame_id)`, kiểm file frame, thử lại 1 lần;
 * sau đó lắp `index.html` và chạy `hyperframes lint`.
 */
export function frameBuildExecutor(d: FrameBuildDeps) {
  const logger = d.logger ?? new Logger();
  return async (ctx: StepRunContext & { only?: string[] }): Promise<FrameBuildResult> => {
    const runtime = d.runtime();
    if (!runtime)
      throw new SfError(
        'E_STEP_INCOMPLETE',
        `step ${ctx.step.id} needs an agent runtime for frame sessions`,
      );
    if (!ctx.waitFrame)
      throw new SfError('E_INTERNAL', 'frame-build needs waitFrame from the workflow engine');
    const v = `videos/${ctx.videoId}`;
    ensureHfProject(ctx.store, ctx.videoId);
    const graph = new BuildGraph({
      store: ctx.store,
      appDataDir: ctx.appDataDir,
      builders: d.builders,
    });
    const pre = await graph.build(ctx.videoId, {
      targets: ['frame_timing', ...(d.builders.active('captions') ? ['captions'] : [])],
      signal: ctx.signal,
    });
    if (pre.status !== 'succeeded') {
      const bad = Object.entries(pre.nodes)
        .filter(([, n]) => n.status === 'failed')
        .map(([id, n]) => `${id}: ${n.error?.message}`);
      throw new SfError(
        'E_PROVIDER_FAILED',
        `audio/timing not ready: ${bad.join('; ') || pre.status}`,
      );
    }
    const timing = (
      JSON.parse(readFileSync(ctx.store.abs(`${v}/.sf/graph.json`), 'utf8')) as {
        nodes: Record<string, { meta?: unknown }>;
      }
    ).nodes['frame_timing']!.meta as FrameTiming;
    const model = loadVideoModel(ctx.store.root, ctx.videoId, ctx.appDataDir);
    const frameMdRel = `${v}/frame.md`;
    if (!existsSync(ctx.store.abs(frameMdRel)))
      throw new SfError(
        'E_FILE_NOT_FOUND',
        'frame.md is missing; run the design-system step first',
      );
    const frameMd = readFileSync(ctx.store.abs(frameMdRel), 'utf8');
    const state = readFramesState(ctx.store, ctx.videoId);
    const packets = new Map<string, { packet: FramePacket; hash: string }>();
    for (const f of model.frames) {
      if (ctx.only && !ctx.only.includes(f.id)) continue;
      const packet = buildFramePacket({
        model,
        timing,
        frameId: f.id,
        assets: stageFrameAssets(ctx.store, ctx.videoId, f.layers),
      });
      packets.set(f.id, {
        packet,
        hash: sha256(canonicalJson({ packet, frameMd: sha256(frameMd) })),
      });
    }
    const todo = [...packets].filter(([id, p]) => {
      const file = ctx.store.abs(`${v}/${p.packet.output_path}`);
      if (!existsSync(file) || state.frames[id]?.packet_hash !== p.hash) return true;
      return (
        checkFrameFile(
          readFileSync(file, 'utf8'),
          id,
          p.packet.frame.layers.map((l) => l.id),
        ).length > 0
      );
    });
    const parallel =
      Number(
        resolveConfig(
          'frame_build.parallel',
          { channelDir: ctx.channelDir, videoId: ctx.videoId },
          { appDataDir: ctx.appDataDir },
        ).value,
      ) || 2;
    const failures: string[] = [];
    /** Một phiên `frame` (tối đa 2 lần); trả lỗi hoặc undefined. */
    const buildOne = async (
      id: string,
      p: { packet: FramePacket; hash: string },
      first?: string,
    ): Promise<string | undefined> => {
      let feedback = first;
      for (let attempt = 1; attempt <= 2; attempt++) {
        const context: SessionContext = {
          session_id: newId('ss') as SessionContext['session_id'],
          kind: 'frame',
          channel_dir: ctx.channelDir,
          video_id: ctx.videoId as SessionContext['video_id'],
          frame_id: id as SessionContext['frame_id'],
          allowed_paths: [p.packet.output_path],
        };
        const waiter = ctx.waitFrame!(id);
        const session = await runtime.openSession(sessionOptionsFor('frame', context, d.gateway));
        let reported: { outputs: string[]; new_element_ids?: string[] } | undefined;
        void waiter.then((r) => (reported = r));
        let error: string | undefined;
        try {
          for await (const e of session.send({
            text: frameInstruction(p.packet, frameMd, ctx.step.id, feedback),
          })) {
            if (e.type === 'error') error = `${e.code}: ${e.message}`;
          }
        } finally {
          await session.close();
        }
        await Promise.race([waiter, new Promise((r) => setTimeout(r, 50))]);
        const file = ctx.store.abs(`${v}/${p.packet.output_path}`);
        const problems = [
          ...(error ? [{ code: 'agent_error', message: error }] : []),
          ...(!reported
            ? [
                {
                  code: 'E_STEP_INCOMPLETE',
                  message: 'workflow.step_complete was not called for this frame',
                },
              ]
            : []),
          ...(existsSync(file)
            ? checkFrameFile(
                readFileSync(file, 'utf8'),
                id,
                p.packet.frame.layers.map((l) => l.id),
              )
            : [{ code: 'missing_file', message: `${p.packet.output_path} was not written` }]),
        ];
        logger.write(problems.length ? 'warn' : 'info', 'sf.frame.build', {
          frame_id: id,
          attempt,
          problems: problems.map((x) => x.code),
        });
        if (
          !problems.length ||
          (problems.every((x) => x.code === 'E_STEP_INCOMPLETE') &&
            existsSync(file) &&
            attempt === 2)
        ) {
          state.frames[id] = {
            packet_hash: p.hash,
            built_at: new Date().toISOString(),
            ...(reported?.new_element_ids?.length
              ? { new_element_ids: reported.new_element_ids }
              : {}),
          };
          return undefined;
        }
        feedback = problems.map((x) => `- ${x.code}: ${x.message}`).join('\n');
      }
      return feedback;
    };
    const saveState = () =>
      ctx.store.write(statePath(ctx.videoId), `${JSON.stringify(state, null, 2)}\n`, {
        by: 'frame-build',
        validate: false,
      });
    await pool(todo, parallel, async ([id, p]) => {
      const err = await buildOne(id, p);
      if (err) failures.push(`${id}: ${err.replace(/\n/g, ' ')}`);
    });
    saveState();
    if (failures.length)
      throw new SfError('E_GATE_FAILED', `frames failed: ${failures.join('; ')}`);
    const built = todo.map(([id]) => id);
    const notYet = model.frames.filter(
      (f) => !existsSync(ctx.store.abs(`${v}/compositions/frames/${f.id}.html`)),
    );
    if (ctx.only && notYet.length) {
      // dựng một phần: chưa đủ frame để lắp index
      return {
        outputs: built.map((id) => `compositions/frames/${id}.html`),
        built,
        skipped: [...packets.keys()].filter((id) => !built.includes(id)),
        summary: `Dựng ${built.length} frame; còn thiếu ${notYet.map((f) => f.id).join(', ')} nên chưa lắp index.html.`,
      };
    }
    const videoDir = ctx.store.abs(v);
    const watch = model.frames.map((f) => ctx.store.abs(`${v}/compositions/frames/${f.id}.html`));
    const sig = ctx.signal ? { signal: ctx.signal } : {};
    /** Lắp index rồi lint (+ check); lỗi gom theo frame (file `compositions/frames/<fr>.html`). */
    const verify = async () => {
      const idx = await graph.build(ctx.videoId, { targets: ['index'], ...sig });
      if (idx.status !== 'succeeded') {
        const bad = Object.entries(idx.nodes)
          .filter(([, n]) => n.status === 'failed')
          .map(([nid, n]) => `${nid}: ${n.error?.message}`);
        throw new SfError('E_GATE_FAILED', `index.html: ${bad.join('; ')}`);
      }
      const lint = await hfLint(videoDir, { watch, ...sig });
      type Err = {
        code?: string;
        rule?: string;
        message?: string;
        selector?: string;
        suggestedColor?: string;
        where: string;
      };
      const errs: Err[] = lint.findings
        .filter((f) => f.severity === 'error')
        .map((f) => ({ ...f, where: f.file ?? '' }));
      if (!errs.length && d.check !== false) {
        const chk = await hfCheck(videoDir, { watch, ...sig });
        errs.push(
          ...chk.errors.map((f) => ({
            ...f,
            where: String((f as { sourceFile?: string }).sourceFile ?? ''),
          })),
        );
      }
      const byFrame = new Map<string, string[]>();
      const general: string[] = [];
      for (const e of errs) {
        const fid = /frames\/(fr_[0-9a-z]{8})\.html/.exec(e.where)?.[1];
        const msg = `${e.code ?? e.rule}: ${e.message}${e.selector ? ` (${e.selector})` : ''}${e.suggestedColor ? ` — gợi ý màu ${e.suggestedColor}` : ''}`;
        if (fid) byFrame.set(fid, [...(byFrame.get(fid) ?? []), msg]);
        else general.push(msg);
      }
      return { byFrame, general, warnings: lint.warningCount };
    };
    let res = await verify();
    if (res.byFrame.size) {
      // một vòng sửa: gửi lại frame kèm phát hiện của lint/check (như orchestrator HyperFrames)
      const redo = [...res.byFrame].filter(([id]) => packets.has(id));
      await pool(redo, parallel, async ([id, msgs]) => {
        const err = await buildOne(
          id,
          packets.get(id)!,
          `hyperframes lint/check báo lỗi trong frame này:\n${[...new Set(msgs)].map((m) => `- ${m}`).join('\n')}`,
        );
        if (err) failures.push(`${id}: ${err.replace(/\n/g, ' ')}`);
      });
      saveState();
      if (failures.length)
        throw new SfError('E_GATE_FAILED', `frames failed: ${failures.join('; ')}`);
      for (const [id] of redo) if (!built.includes(id)) built.push(id);
      res = await verify();
    }
    const left = [
      ...res.general,
      ...[...res.byFrame].flatMap(([id, m]) => m.map((x) => `${id}: ${x}`)),
    ];
    if (left.length)
      throw new SfError(
        'E_GATE_FAILED',
        `hyperframes lint/check: ${[...new Set(left)].slice(0, 8).join('; ')}`,
      );
    return {
      outputs: [...model.frames.map((f) => `compositions/frames/${f.id}.html`), 'index.html'],
      built,
      skipped: [...packets.keys()].filter((id) => !built.includes(id)),
      summary: `Dựng ${built.length} frame (${[...packets.keys()].length - built.length} giữ nguyên); lint/check qua, ${res.warnings} cảnh báo lint.`,
    };
  };
}
