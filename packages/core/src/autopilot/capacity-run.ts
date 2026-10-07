import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveAppConfig } from '../config/resolve.js';
import type { VideoState } from '../contracts/types.js';
import { listVideoIds } from '../domain/video.js';
import type { Db } from '../store/db.js';
import type { WorkflowService } from '../workflow/service.js';
import {
  capacityFromDb,
  readStepSpans,
  readVideoTokens,
  remainingWork,
  workflowCost,
  type CapacityChannel,
  type CapacityResult,
} from './capacity.js';
import { readQuotaUsed } from '../publish/quota.js';
import type { PlanWorkflow } from './plan.js';

/** Workflow đã cài và tương thích (id, bước, dạng xuất) — đầu vào của năng lực (050) và kế hoạch ngày (051). */
export function installedWorkflows(
  workflows: WorkflowService,
): (PlanWorkflow & { steps: string[] })[] {
  return workflows
    .packs()
    .filter((p) => p.compatible)
    .map((p) => ({
      id: p.manifest.id,
      steps: p.manifest.steps.map((s) => s.id),
      output_profiles: p.manifest.output_profiles,
    }));
}

/**
 * Năng lực hôm nay (050) cho nhóm kênh: video đang chạy dở của các kênh đó trừ phần việc còn lại vào quỹ
 * thời gian/token, rồi `capacityFromDb`. Dùng chung cho IPC `autopilot.capacity` và bộ lập kế hoạch (051).
 */
export function capacityRun(o: {
  db: Db;
  appDataDir: string;
  workflows: WorkflowService;
  channels: CapacityChannel[];
  now?: number;
}): CapacityResult {
  const cfg = <T>(k: string) => resolveAppConfig<T>(k, { appDataDir: o.appDataDir });
  const workflows = installedWorkflows(o.workflows).map((w) => ({ id: w.id, steps: w.steps }));
  const spans = readStepSpans(o.db);
  const tokens = readVideoTokens(o.db);
  let busy_ms = 0;
  let busy_tokens = 0;
  for (const ch of o.channels)
    for (const id of listVideoIds(ch.channel)) {
      const f = path.join(ch.channel, 'videos', id, 'state.json');
      if (!existsSync(f)) continue;
      const st = JSON.parse(readFileSync(f, 'utf8')) as VideoState;
      if (!st.workflow || !Object.values(st.steps).some((s) => s.status === 'running')) continue;
      const steps = workflows.find((w) => w.id === st.workflow!.id)?.steps;
      const left = remainingWork(
        workflowCost(st.workflow.id, spans, tokens, steps ? { steps } : {}),
        st.steps,
      );
      busy_ms += left.ms;
      busy_tokens += left.tokens;
    }
  const daily = cfg<number | null>('autopilot.daily_tokens');
  return capacityFromDb(o.db, {
    now: o.now ?? Date.now(),
    timezone: cfg<string>('publish.timezone'),
    work_window: cfg<string>('autopilot.work_window'),
    budget_share: Number(cfg('autopilot.budget_share')),
    daily_tokens: typeof daily === 'number' && daily > 0 ? daily : null,
    workflows,
    channels: o.channels,
    busy_ms,
    busy_tokens,
    // 053: quota YouTube thật đã dùng hôm nay (sổ đếm của bộ đăng) thay vì 0
    youtube_units_used_today: readQuotaUsed(o.appDataDir, new Date(o.now ?? Date.now())),
  });
}
