import { existsSync, readFileSync } from 'node:fs';
import { resolveConfig } from '../config/resolve.js';
import type { VideoState } from '../contracts/types.js';
import type { Db } from '../store/db.js';
import type { WriteStore } from '../store/writer.js';

export interface CostTotals {
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  /** Giây chiếm GPU (`kind = gpu`). */
  gpu_s: number;
  /** Số ảnh API (`kind = image_api`). */
  images: number;
}

const zero = (): CostTotals => ({
  calls: 0,
  input_tokens: 0,
  output_tokens: 0,
  cost_usd: 0,
  gpu_s: 0,
  images: 0,
});

export interface CostReport {
  video_id: string;
  total: CostTotals;
  /** Theo bước (null = ngoài bước workflow, ví dụ chat) → theo loại. */
  steps: { step_id: string | null; total: CostTotals; kinds: Record<string, CostTotals> }[];
  budget: {
    tokens_used: number;
    api_cost_usd: number;
    limit_tokens: number | null;
    limit_api_cost_usd: number | null;
  };
  /** Có giá ước tính (ảnh API theo `settings.pricing`). */
  estimated: boolean;
}

const r6 = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * Báo cáo chi phí (UI-12, D11 mục 3, FR-OB-03): bảng `usage` (ghi từ span khi kết thúc — cùng nguồn với
 * trace, AC-M3-04) theo video → bước → loại; so ngân sách video.
 */
export function costReport(
  db: Db,
  store: WriteStore,
  videoId: string,
  appDataDir?: string,
): CostReport {
  const rows = db
    .prepare(
      'SELECT step_id, kind, input_tokens, output_tokens, units, cost_usd, source FROM usage WHERE video_id = ? ORDER BY ts',
    )
    .all(videoId) as {
    step_id: string | null;
    kind: string;
    input_tokens: number;
    output_tokens: number;
    units: number;
    cost_usd: number;
    source: string;
  }[];
  const total = zero();
  const steps = new Map<string | null, { total: CostTotals; kinds: Record<string, CostTotals> }>();
  const add = (t: CostTotals, r: (typeof rows)[number]) => {
    t.calls += 1;
    t.input_tokens += r.input_tokens;
    t.output_tokens += r.output_tokens;
    t.cost_usd = r6(t.cost_usd + r.cost_usd);
    if (r.kind === 'gpu') t.gpu_s = r6(t.gpu_s + r.units);
    if (r.kind === 'image_api') t.images += r.units;
  };
  for (const r of rows) {
    const s = steps.get(r.step_id) ?? { total: zero(), kinds: {} };
    add(s.total, r);
    add((s.kinds[r.kind] ??= zero()), r);
    steps.set(r.step_id, s);
    add(total, r);
  }
  const st = (() => {
    const f = store.abs(`videos/${videoId}/state.json`);
    return existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as VideoState) : undefined;
  })();
  const scope = { channelDir: store.root, videoId };
  const lim = (k: string) => {
    const v = Number(resolveConfig(k, scope, { appDataDir }).value);
    return v > 0 ? v : null;
  };
  return {
    video_id: videoId,
    total,
    steps: [...steps.entries()].map(([step_id, v]) => ({ step_id, ...v })),
    budget: {
      tokens_used: st?.budget?.tokens_used ?? 0,
      api_cost_usd: st?.budget?.api_cost_usd ?? 0,
      limit_tokens: st?.budget?.limits?.tokens ?? lim('budget.tokens_per_video'),
      limit_api_cost_usd: st?.budget?.limits?.api_cost_usd ?? lim('budget.api_cost_usd_per_video'),
    },
    estimated: rows.some((r) => r.source === 'estimated'),
  };
}

/** CSV của báo cáo (UI-12 "xuất CSV"): một dòng mỗi bước × loại + dòng tổng. */
export function costCsv(r: CostReport): string {
  const head = 'video_id,step_id,kind,calls,input_tokens,output_tokens,cost_usd,gpu_s,images';
  const line = (step: string, kind: string, t: CostTotals) =>
    [
      r.video_id,
      step,
      kind,
      t.calls,
      t.input_tokens,
      t.output_tokens,
      t.cost_usd,
      t.gpu_s,
      t.images,
    ].join(',');
  return [
    head,
    ...r.steps.flatMap((s) => Object.entries(s.kinds).map(([k, t]) => line(s.step_id ?? '', k, t))),
    line('', 'total', r.total),
  ].join('\n');
}
