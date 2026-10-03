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
}

/** Executor bước engine (D6 mục 2 cột "engine"); trả file đầu ra (tương đối video). */
export type StepExecutor = (ctx: StepRunContext) => Promise<{ outputs?: string[] }>;

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
        const s = st.steps[id]!;
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
    for (const [id, s] of Object.entries(st.steps)) {
      if (s.status !== 'running') continue;
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
    const st = this.readState();
    const v = (st.config_overrides as Record<string, unknown>)[c.config];
    return v === c.equals;
  }

  /** Chạy một bước; trả `true` nếu có thể chạy tiếp tự động. */
  private async runStep(decl: StepDecl): Promise<boolean> {
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
    };
    const spec = STEP_LIBRARY[decl.uses];
    let outputs: string[] = spec.outputs(decl.params);
    try {
      if (spec.by === 'engine') {
        const exec = this.d.executors.get(decl.uses);
        if (!exec)
          throw new SfError(
            'E_WORKFLOW_INCOMPATIBLE',
            `no executor for step type ${decl.uses} in this app version`,
          );
        const r = await exec(ctx);
        if (r.outputs?.length) outputs = r.outputs;
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
        st.approvals.push(
          this.newApproval(
            st,
            decl.id,
            outputs.filter((o) => this.hashOf(o) !== null),
          ),
        );
        s.status = 'waiting_approval';
        this.writeState(st);
        return false;
      }
      s.status = 'done';
      this.writeState(st);
      return true;
    });
  }

  private async runAgent(
    decl: StepDecl,
    ctx: StepRunContext,
    manifest: WorkflowManifest,
  ): Promise<string[] | undefined> {
    const runner = this.d.agentRunner();
    if (!runner)
      throw new SfError(
        'E_STEP_INCOMPLETE',
        `step ${decl.id} needs an agent session (no agent session attached)`,
      );
    const spec = STEP_LIBRARY[decl.uses];
    const instruction = [
      `Thực hiện bước ${decl.id} của workflow ${manifest.id} theo skill.`,
      `Đầu vào: ${spec.reads(decl.params).join(', ')}.`,
      `Đầu ra: ${spec.outputs(decl.params).join(', ') || spec.writes(decl.params).join(', ')}.`,
      ...(ctx.note ? [`Yêu cầu sửa của người dùng: ${ctx.note}`] : []),
      `Khi xong gọi mcp__sf__workflow_step_complete với step_id "${decl.id}".`,
    ].join('\n');
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

  /** `workflow.step_complete` (D4 mục 2.4). */
  async stepComplete(stepId: string, outputs: string[]): Promise<{ next_step?: string }> {
    const resolve = this.completions.get(stepId);
    if (!resolve) {
      const st = this.readState();
      if (!st.steps[stepId]) throw new SfError('E_ID_UNKNOWN', `step ${stepId} not in workflow`);
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
