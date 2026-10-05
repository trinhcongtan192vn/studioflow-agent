import { withSpan } from '../trace/trace.js';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync } from 'node:fs';
import type {
  Approval,
  StepDecl,
  StepState,
  VideoState,
  VideoStateSummary,
  WorkflowManifest,
} from '../contracts/types.js';
import { sha256 } from '../domain/hash.js';
import { newId } from '../domain/ids.js';
import { parseBlocksDoc, serializeBlocksDoc } from '../domain/markdown/blocks.js';
import { isSfError, SfError } from '../errors.js';
import type { BuilderRegistry } from '../graph/graph.js';
import type { WriteStore } from '../store/writer.js';
import { evaluateGate, type GateResult } from './gates.js';
import { executionOrder, STEP_LIBRARY } from './library.js';
import { resolveConfig } from '../config/resolve.js';
import { phaseBefore, type WorkflowPack } from './packs.js';

export interface StepRunContext {
  store: WriteStore;
  channelDir: string;
  videoId: string;
  step: StepDecl;
  manifest: WorkflowManifest;
  /** Ghi chú của lần `changes_requested` gần nhất cho bước này. */
  note?: string;
  signal: AbortSignal;
  appDataDir?: string;
  /** Thư mục gói workflow (rubric `rubrics/` của gói, D6 4.3). */
  packDir?: string;
  /** Chờ phiên `frame` báo `workflow.step_complete` kèm `frame_id` (011). */
  waitFrame?: (frameId: string) => Promise<FrameCompletion>;
  /** Giao bước cho phiên `main` theo skill của gói (executor có phần agent, 023); `extra` nối vào chỉ dẫn. */
  agent?: (extra?: string) => Promise<string[] | undefined>;
  /** Chờ `workflow.step_complete` của bước (phiên `producer` do executor mở, 023); gọi trước khi mở phiên. */
  waitComplete?: () => Promise<string[]>;
  /** Chỉ dẫn giao bước như bước agent; `extra` nối vào trước lời nhắc báo xong. */
  instruction?: (extra?: string) => string;
}

export interface FrameCompletion {
  outputs: string[];
  new_element_ids?: string[];
}

/** Executor bước engine (D6 mục 2 cột "engine"); trả file đầu ra (tương đối video). */
export type StepExecutor = (ctx: StepRunContext) => Promise<StepExecutorResult>;

/** `summary` gắn vào ghi chú approval, `refine` vào `steps[id].refine` (009 FR-009). */
export interface StepExecutorResult {
  outputs?: string[];
  summary?: string;
  refine?: StepState['refine'];
}

/** Giao bước agent cho phiên agent (008: phiên `main`); bước xong khi gọi `stepComplete`. */
export type AgentStepRunner = (
  instruction: string,
  ctx: StepRunContext & { stepComplete(outputs: string[]): Promise<void> },
) => Promise<void>;

export interface EngineDeps {
  store: WriteStore;
  videoId: string;
  packs: () => WorkflowPack[];
  executors: Map<string, StepExecutor>;
  agentRunner: () => AgentStepRunner | undefined;
  builders: BuilderRegistry;
  appDataDir?: string;
  runScript?: (
    manifest: WorkflowManifest,
    id: string,
  ) => Promise<{ exit_code: number | null; stderr: string }>;
}

const now = () => new Date().toISOString();
const RUNNABLE = new Set<StepState['status']>(['pending', 'stale']);

/**
 * Workflow Engine của một video (D6 mục 3): briefing, vòng đời bước, gate, approval, rewind,
 * điều phối tự động, khôi phục. Trạng thái nguồn là `state.json` (ghi qua module ghi).
 */
export class WorkflowEngine extends EventEmitter {
  private chain: Promise<unknown> = Promise.resolve();
  private paused = false;
  private target?: string;
  private running?: Promise<void>;
  private readonly completions = new Map<string, (outputs: string[]) => void>();
  private readonly frameWaiters = new Map<string, (r: FrameCompletion) => void>();

  constructor(private readonly d: EngineDeps) {
    super();
  }

  private get v(): string {
    return `videos/${this.d.videoId}`;
  }

  private exclusive<T>(fn: () => Promise<T> | T): Promise<T> {
    const next = this.chain.then(fn, fn);
    this.chain = next.catch(() => {});
    return next;
  }

  // ---------- state.json ----------

  readState(): VideoState {
    return JSON.parse(readFileSync(this.d.store.abs(`${this.v}/state.json`), 'utf8')) as VideoState;
  }

  private writeState(st: VideoState): void {
    st.updated_at = now();
    this.d.store.write(`${this.v}/state.json`, `${JSON.stringify(st, null, 2)}\n`, {
      by: 'workflow',
    });
    this.emit('workflow.updated', this.summaryOf(st));
  }

  private hashOf(rel: string): string | null {
    const abs = this.d.store.abs(`${this.v}/${rel}`);
    return existsSync(abs) ? sha256(readFileSync(abs)) : null;
  }

  private pack(st: VideoState): WorkflowPack | undefined {
    const id = st.workflow?.id;
    return id ? this.d.packs().find((p) => p.manifest.id === id) : undefined;
  }

  private manifestOf(st: VideoState): WorkflowManifest {
    const p = this.pack(st);
    if (!p)
      throw new SfError(
        'E_WORKFLOW_INCOMPATIBLE',
        `workflow ${st.workflow?.id ?? '(none)'} is not installed`,
      );
    return p.manifest;
  }

  /** Approval đã duyệt có file đổi hash → về `pending`, bước về `waiting_approval` (D6 mục 3.1). */
  private invalidate(st: VideoState): boolean {
    let changed = false;
    for (const a of st.approvals) {
      if (a.status !== 'approved' || a.step_id === 'brief') continue;
      const stale = Object.entries(a.artifact_hashes).some(([f, h]) => this.hashOf(f) !== h);
      if (stale) {
        a.status = 'pending';
        delete a.decided_at;
        const s = st.steps[a.step_id];
        if (s) s.status = 'waiting_approval';
        changed = true;
      }
    }
    return changed;
  }

  // ---------- trạng thái tóm tắt ----------

  private summaryOf(st: VideoState): VideoStateSummary {
    const manifest = this.pack(st)?.manifest;
    const titles = new Map((manifest?.steps ?? []).map((s) => [s.id, s.title]));
    const ids = manifest ? manifest.steps.map((s) => s.id) : Object.keys(st.steps);
    const steps = ids
      .filter((id) => st.steps[id])
      .map((id) => ({
        id,
        title: titles.get(id) ?? id,
        status: st.steps[id]!.status,
        ...(st.steps[id]!.refine ? { refine: st.steps[id]!.refine } : {}),
      }));
    const current = steps.find((s) => s.status !== 'done' && s.status !== 'skipped')?.id;
    return {
      video_id: st.video_id,
      phase: st.phase,
      workflow: st.workflow,
      ...(current ? { current_step: current } : {}),
      steps,
      pending_approvals: st.approvals.filter((a) => a.status === 'pending').map((a) => a.id),
      owner: st.owner,
      budget: st.budget,
    };
  }

  /** `workflow.state` (D4 mục 3.1); áp approval mất hiệu lực trước khi trả. */
  summary(): VideoStateSummary {
    const st = this.readState();
    if (this.invalidate(st)) this.writeState(st);
    return this.summaryOf(st);
  }

  // ---------- briefing (D6 mục 3.0) ----------

  select(workflowId: string, outputProfile: string): Promise<void> {
    return this.exclusive(() => {
      const st = this.readState();
      if (st.phase !== 'briefing')
        throw new SfError(
          'E_WORKFLOW_INCOMPATIBLE',
          'workflow already selected; rewind to briefing first',
        );
      const pack = this.d.packs().find((p) => p.manifest.id === workflowId && p.compatible);
      if (!pack)
        throw new SfError(
          'E_WORKFLOW_INCOMPATIBLE',
          `workflow ${workflowId} is not installed or not compatible`,
        );
      if (!pack.manifest.output_profiles.includes(outputProfile)) {
        throw new SfError(
          'E_WORKFLOW_INCOMPATIBLE',
          `output profile ${outputProfile} is not allowed by ${workflowId} (${pack.manifest.output_profiles.join(', ')})`,
        );
      }
      const briefRel = `${this.v}/BRIEF.md`;
      const brief = parseBlocksDoc(readFileSync(this.d.store.abs(briefRel), 'utf8'));
      brief.front = {
        ...brief.front,
        proposed_workflow: { id: pack.manifest.id, version: pack.manifest.version },
        proposed_output_profile: outputProfile,
      };
      this.d.store.write(briefRel, serializeBlocksDoc(brief), { by: 'workflow.select' });
      st.approvals = st.approvals.filter((a) => !(a.step_id === 'brief' && a.status === 'pending'));
      st.approvals.push(this.newApproval(st, 'brief', ['BRIEF.md']));
      this.writeState(st);
    });
  }

  private newApproval(st: VideoState, stepId: string, files: string[]): Approval {
    const hashes: Record<string, string> = {};
    for (const f of files) {
      const h = this.hashOf(f);
      if (h) hashes[f] = h;
    }
    return {
      id: newId('ap', new Set(st.approvals.map((a) => a.id))) as Approval['id'],
      step_id: stepId,
      status: 'pending',
      requested_at: now(),
      artifact_hashes: hashes,
    };
  }

  // ---------- quyết định duyệt ----------

  async approve(approvalId: string): Promise<void> {
    await this.exclusive(() => {
      const st = this.readState();
      const a = st.approvals.find((x) => x.id === approvalId);
      if (!a) throw new SfError('E_ID_UNKNOWN', `approval ${approvalId} not found`);
      a.status = 'approved';
      a.decided_at = now();
      // duyệt nội dung hiện tại: duyệt lại sau khi mất hiệu lực (file đổi) cập nhật hash
      for (const f of Object.keys(a.artifact_hashes)) {
        const h = this.hashOf(f);
        if (h) a.artifact_hashes[f] = h;
      }
      if (a.step_id === 'brief') this.startWorkflow(st);
      else if (st.steps[a.step_id]) st.steps[a.step_id]!.status = 'done';
      this.writeState(st);
    });
    if (!this.paused) await this.advance();
  }

  private startWorkflow(st: VideoState): void {
    const brief = parseBlocksDoc(readFileSync(this.d.store.abs(`${this.v}/BRIEF.md`), 'utf8'));
    const wf = brief.front.proposed_workflow as { id: string; version: string } | null;
    const pack = wf && this.d.packs().find((p) => p.manifest.id === wf.id);
    if (!pack)
      throw new SfError(
        'E_WORKFLOW_INCOMPATIBLE',
        'BRIEF.md has no installed proposed_workflow; call workflow.select',
      );
    st.workflow = { id: pack.manifest.id, version: pack.manifest.version };
    st.output_profile =
      (brief.front.proposed_output_profile as string) ?? pack.manifest.output_profiles[0]!;
    st.steps = Object.fromEntries(
      pack.manifest.steps.map((s) => [s.id, { status: 'pending', attempt: 0 } as StepState]),
    );
    st.phase = 'workflow';
    // 030: shorts cắt từ video dài → video nguồn đọc được (artifact.read `video:<vd>/…`)
    const source = brief.front.source_video_id as string | null | undefined;
    if (source) {
      if (!existsSync(this.d.store.abs(`videos/${source}/state.json`)))
        throw new SfError('E_ID_UNKNOWN', `source video ${source} does not exist in this channel`);
      st.read_only_videos = [
        ...new Set([...(st.read_only_videos ?? []), source]),
      ] as VideoState['read_only_videos'];
    }
    brief.front = { ...brief.front, approved_at: now() };
    this.d.store.write(`${this.v}/BRIEF.md`, serializeBlocksDoc(brief), { by: 'workflow.approve' });
  }

  async requestChanges(approvalId: string, note: string): Promise<void> {
    await this.exclusive(() => {
      const st = this.readState();
      const a = st.approvals.find((x) => x.id === approvalId);
      if (!a) throw new SfError('E_ID_UNKNOWN', `approval ${approvalId} not found`);
      a.status = 'changes_requested';
      a.decided_at = now();
      a.note = note;
      if (st.steps[a.step_id]) st.steps[a.step_id]!.status = 'pending';
      this.writeState(st);
    });
    if (!this.paused) await this.advance();
  }

  annotate(stepId: string, summary: string): Promise<void> {
    return this.exclusive(() => {
      const st = this.readState();
      const a = [...st.approvals]
        .reverse()
        .find((x) => x.step_id === stepId && x.status === 'pending');
      if (!a) throw new SfError('E_ID_UNKNOWN', `no pending approval for step ${stepId}`);
      a.note = summary;
      this.writeState(st);
    });
  }

  // ---------- điều khiển (D6 mục 3.2) ----------

  pause(): void {
    this.paused = true;
  }

  runTo(stepId: string): Promise<void> {
    this.paused = false;
    this.target = stepId;
    return this.advance();
  }

  rewind(stepId: string): Promise<void> {
    return this.exclusive(() => {
      const st = this.readState();
      const manifest = this.manifestOf(st);
      const { order } = executionOrder(manifest.steps);
      const i = order.indexOf(stepId);
      if (i < 0) throw new SfError('E_ID_UNKNOWN', `step ${stepId} not in workflow`);
      st.steps[stepId] = { ...st.steps[stepId]!, status: 'pending' };
      for (const id of order.slice(i + 1)) {
        const s = st.steps[id];
        if (!s) continue; // state.json chưa có bước này (chưa từng chạy)
        if (s.status !== 'pending' && s.status !== 'skipped') s.status = 'stale';
      }
      this.writeState(st);
    }).then(() => {
      this.paused = false;
      void this.advance();
    });
  }

  /** Chờ vòng điều phối đang chạy (nếu có) kết thúc. */
  async idle(): Promise<void> {
    while (this.running) await this.running;
    await this.chain;
  }

  /** Khôi phục khi mở video (D6 mục 3.1, FR-WS-04). */
  open(): void {
    const st = this.readState();
    if (st.phase !== 'workflow') return;
    const manifest = this.pack(st)?.manifest;
    let changed = this.invalidate(st);
    // 008: vòng điều phối của engine này đang chạy → bước `running` là thật (người dùng chỉ mở lại
    // video trong cùng tiến trình), không phải bước mồ côi sau khi app tắt
    for (const [id, s] of Object.entries(st.steps)) {
      if (s.status !== 'running' || this.running) continue;
      const decl = manifest?.steps.find((x) => x.id === id);
      s.status = 'pending';
      if (decl && STEP_LIBRARY[decl.uses].by === 'agent') {
        s.error = {
          code: 'E_STEP_INCOMPLETE',
          message: 'app closed during an agent step; confirm to run it again',
        };
      }
      changed = true;
    }
    if (changed) this.writeState(st);
  }

  /** Điều phối: chạy liên tiếp tới điểm duyệt, lỗi, tạm dừng hoặc bước đích. */
  advance(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.loop().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async loop(): Promise<void> {
    for (;;) {
      if (this.paused) return;
      const next = await this.exclusive(() => this.pickNext());
      if (!next) return;
      const ok = await this.runStep(next);
      if (!ok || this.target === next.id) {
        if (this.target === next.id) this.target = undefined;
        return;
      }
    }
  }

  private pickNext(): StepDecl | undefined {
    const st = this.readState();
    if (st.phase !== 'workflow') return undefined;
    if (this.invalidate(st)) this.writeState(st);
    const manifest = this.manifestOf(st);
    const byId = new Map(manifest.steps.map((s) => [s.id, s]));
    const { order } = executionOrder(manifest.steps);
    // bước chưa có trong state.json (video cũ, state khôi phục tay) = chưa chạy
    const missing = order.filter((id) => !st.steps[id]);
    if (missing.length) {
      for (const id of missing) st.steps[id] = { status: 'pending', attempt: 0 };
      this.writeState(st);
    }
    for (const [i, id] of order.entries()) {
      const s = st.steps[id]!;
      if (s.status === 'waiting_approval' || s.status === 'failed' || s.status === 'running')
        return undefined;
      if (!RUNNABLE.has(s.status)) continue;
      const decl = byId.get(id)!;
      const after = decl.after ?? (i > 0 ? [order[i - 1]!] : []);
      if (!after.every((a) => ['done', 'skipped'].includes(st.steps[a]?.status ?? 'done')))
        return undefined;
      return decl;
    }
    return undefined;
  }

  private skip(decl: StepDecl): boolean {
    const c = decl.skip_if;
    if (!c) return false;
    if ('phase_before' in c) return phaseBefore(c.phase_before);
    // giá trị đã giải theo tầng app → kênh → video (D3 7.1), ví dụ `lipsync.enabled` đặt ở kênh (027)
    const v = resolveConfig(
      c.config,
      { channelDir: this.d.store.root, videoId: this.d.videoId },
      { appDataDir: this.d.appDataDir },
    ).value;
    return v === c.equals;
  }

  /** Chạy một bước trong span `sf.workflow.step` (D11); trả `true` nếu có thể chạy tiếp tự động. */
  private runStep(decl: StepDecl): Promise<boolean> {
    const st = this.readState();
    return withSpan(
      'sf.workflow.step',
      {
        'sf.video_id': this.d.videoId,
        'sf.workflow_id': st.workflow?.id,
        'sf.step_id': decl.id,
        'sf.attempt': (st.steps[decl.id]?.attempt ?? 0) + 1,
      },
      () => this.runStepInner(decl),
    );
  }

  private async runStepInner(decl: StepDecl): Promise<boolean> {
    const st0 = this.readState();
    const manifest = this.manifestOf(st0);
    if (this.skip(decl)) {
      await this.exclusive(() => {
        const st = this.readState();
        st.steps[decl.id] = { ...st.steps[decl.id]!, status: 'skipped' };
        this.writeState(st);
      });
      return true;
    }
    const note = [...st0.approvals]
      .reverse()
      .find((a) => a.step_id === decl.id && a.status === 'changes_requested')?.note;
    await this.exclusive(() => {
      const st = this.readState();
      const prev = st.steps[decl.id]!;
      st.steps[decl.id] = { status: 'running', attempt: prev.attempt + 1, started_at: now() };
      this.writeState(st);
    });
    const ctrl = new AbortController();
    const ctx: StepRunContext = {
      store: this.d.store,
      channelDir: this.d.store.root,
      videoId: this.d.videoId,
      step: decl,
      manifest,
      ...(note ? { note } : {}),
      signal: ctrl.signal,
      appDataDir: this.d.appDataDir,
      ...(this.pack(st0)?.dir ? { packDir: this.pack(st0)!.dir } : {}),
      waitFrame: (frameId) => this.waitFrame(decl.id, frameId),
    };
    ctx.agent = (more) => this.runAgent(decl, ctx, manifest, more);
    ctx.instruction = (more) => this.instructionFor(decl, ctx, manifest, more);
    ctx.waitComplete = () =>
      new Promise<string[]>((resolve) => this.completions.set(decl.id, resolve));
    const spec = STEP_LIBRARY[decl.uses];
    let outputs: string[] = spec.outputs(decl.params);
    let extra: Omit<StepExecutorResult, 'outputs'> = {};
    try {
      // bước agent có executor riêng (frame-build: phiên `frame` × N, 011) chạy như bước engine
      if (spec.by === 'engine' || this.d.executors.has(decl.uses)) {
        const exec = this.d.executors.get(decl.uses);
        if (!exec)
          throw new SfError(
            'E_WORKFLOW_INCOMPATIBLE',
            `no executor for step type ${decl.uses} in this app version`,
          );
        const { outputs: out, ...rest } = await exec(ctx);
        if (out?.length) outputs = out;
        extra = rest;
      } else {
        outputs = (await this.runAgent(decl, ctx, manifest)) ?? outputs;
      }
    } catch (e) {
      await this.fail(decl.id, isSfError(e) ? e.code : 'E_INTERNAL', String((e as Error).message));
      return false;
    }
    const results = await this.gates(decl, this.readState(), manifest);
    const failed = results.filter((r) => !r.pass);
    return this.exclusive(() => {
      const st = this.readState();
      const s = st.steps[decl.id]!;
      s.finished_at = now();
      s.outputs = outputs;
      if (extra.refine) s.refine = extra.refine;
      if (failed.length) {
        s.status = 'failed';
        s.error = {
          code: 'E_GATE_FAILED',
          message: failed.map((f) => `${f.gate}(${f.target}): ${f.detail ?? 'failed'}`).join('; '),
        };
        this.writeState(st);
        return false;
      }
      delete s.error;
      if (decl.approval?.required) {
        const a = this.newApproval(
          st,
          decl.id,
          outputs.filter((o) => this.hashOf(o) !== null),
        );
        if (extra.summary) a.note = extra.summary;
        st.approvals.push(a);
        s.status = 'waiting_approval';
        this.writeState(st);
        return false;
      }
      s.status = 'done';
      this.writeState(st);
      return true;
    });
  }

  /** Chỉ dẫn giao bước cho agent (bước agent và executor có phần agent, 023). */
  private instructionFor(
    decl: StepDecl,
    ctx: StepRunContext,
    manifest: WorkflowManifest,
    extra?: string,
  ): string {
    const spec = STEP_LIBRARY[decl.uses];
    return [
      `Thực hiện bước ${decl.id} của workflow ${manifest.id} theo skill ${manifest.id}.`,
      `Đầu vào: ${spec.reads(decl.params).join(', ')}.`,
      `Đầu ra: ${spec.outputs(decl.params).join(', ') || spec.writes(decl.params).join(', ')}.`,
      ...(ctx.note ? [`Yêu cầu sửa của người dùng: ${ctx.note}`] : []),
      ...(extra ? [extra] : []),
      `Khi xong gọi mcp__sf__workflow_step_complete với step_id "${decl.id}".`,
    ].join('\n');
  }

  private async runAgent(
    decl: StepDecl,
    ctx: StepRunContext,
    manifest: WorkflowManifest,
    extra?: string,
  ): Promise<string[] | undefined> {
    const runner = this.d.agentRunner();
    if (!runner)
      throw new SfError(
        'E_STEP_INCOMPLETE',
        `step ${decl.id} needs an agent session (no agent session attached)`,
      );
    const instruction = this.instructionFor(decl, ctx, manifest, extra);
    let outputs: string[] | undefined;
    let finished = false;
    this.completions.set(decl.id, (o) => {
      outputs = o;
      finished = true;
    });
    try {
      await runner(instruction, {
        ...ctx,
        stepComplete: async (o) => void (await this.stepComplete(decl.id, o)),
      });
      if (!finished)
        throw new SfError('E_STEP_INCOMPLETE', `agent stopped without completing step ${decl.id}`);
      return outputs?.length ? outputs : undefined;
    } finally {
      this.completions.delete(decl.id);
    }
  }

  /** Ngữ cảnh bước frame-build để dựng lại frame ngoài lượt chạy bước (nút `frame_html`, 020). */
  frameBuildContext(signal: AbortSignal): StepRunContext {
    const st = this.readState();
    const manifest = this.manifestOf(st);
    const decl = manifest.steps.find((s) => s.uses === 'frame-build');
    if (!decl) throw new SfError('E_STEP_INCOMPLETE', 'this workflow has no frame-build step');
    return {
      store: this.d.store,
      channelDir: this.d.store.root,
      videoId: this.d.videoId,
      step: decl,
      manifest,
      signal,
      appDataDir: this.d.appDataDir,
      ...(this.pack(st)?.dir ? { packDir: this.pack(st)!.dir } : {}),
      waitFrame: (frameId) => this.waitFrame(decl.id, frameId),
    };
  }

  /** Hứa hẹn hoàn tất khi phiên `frame` gọi `workflow.step_complete` với `frame_id` (011). */
  waitFrame(stepId: string, frameId: string): Promise<FrameCompletion> {
    return new Promise((resolve) => this.frameWaiters.set(`${stepId}:${frameId}`, resolve));
  }

  /** `workflow.step_complete` (D4 mục 2.4). */
  async stepComplete(
    stepId: string,
    outputs: string[],
    frame?: { frame_id: string; new_element_ids?: string[] },
  ): Promise<{ next_step?: string }> {
    if (frame) {
      const w = this.frameWaiters.get(`${stepId}:${frame.frame_id}`);
      if (!w)
        throw new SfError(
          'E_STEP_INCOMPLETE',
          `frame ${frame.frame_id} of step ${stepId} is not waiting for an agent`,
        );
      this.frameWaiters.delete(`${stepId}:${frame.frame_id}`);
      w({ outputs, ...(frame.new_element_ids ? { new_element_ids: frame.new_element_ids } : {}) });
      return {};
    }
    const resolve = this.completions.get(stepId);
    if (!resolve) {
      const st = this.readState();
      if (!st.steps[stepId]) throw new SfError('E_ID_UNKNOWN', `step ${stepId} not in workflow`);
      // 008: bước đã chờ duyệt → chỉ agent cách hướng dẫn người dùng (thẻ ghim cuối khung chat)
      if (st.steps[stepId]!.status === 'waiting_approval')
        throw new SfError(
          'E_STEP_INCOMPLETE',
          `step ${stepId} is already complete and waiting for user approval: tell the user to press "Duyệt" on the approval card pinned at the bottom of the chat (do not cite approval ids); do not redo the step`,
        );
      throw new SfError('E_STEP_INCOMPLETE', `step ${stepId} is not waiting for an agent`);
    }
    resolve(outputs);
    const st = this.readState();
    const manifest = this.manifestOf(st);
    const { order } = executionOrder(manifest.steps);
    const next = order[order.indexOf(stepId) + 1];
    return next ? { next_step: next } : {};
  }

  private async gates(
    decl: StepDecl,
    st: VideoState,
    manifest: WorkflowManifest,
  ): Promise<GateResult[]> {
    const all = [...STEP_LIBRARY[decl.uses].gates(decl.params), ...(decl.gate ?? [])];
    const ctx = {
      store: this.d.store,
      videoId: this.d.videoId,
      state: st,
      builders: this.d.builders,
      appDataDir: this.d.appDataDir,
      ...(this.d.runScript ? { runScript: (id: string) => this.d.runScript!(manifest, id) } : {}),
    };
    const out: GateResult[] = [];
    for (const g of all) out.push(await evaluateGate(g, ctx));
    return out;
  }

  /** `workflow.gate_check` — không đổi trạng thái. */
  async gateCheck(stepId: string): Promise<{ pass: boolean; results: GateResult[] }> {
    const st = this.readState();
    const manifest = this.manifestOf(st);
    const decl = manifest.steps.find((s) => s.id === stepId);
    if (!decl) throw new SfError('E_ID_UNKNOWN', `step ${stepId} not in workflow`);
    const results = await this.gates(decl, st, manifest);
    return { pass: results.every((r) => r.pass), results };
  }

  private fail(stepId: string, code: string, message: string): Promise<void> {
    return this.exclusive(() => {
      const st = this.readState();
      const s = st.steps[stepId]!;
      s.status = 'failed';
      s.finished_at = now();
      s.error = { code, message: message.split('\n')[0]! };
      this.writeState(st);
    });
  }
}
