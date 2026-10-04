import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { ReviewRound, VideoState } from '../contracts/types.js';
import { sha256 } from '../domain/hash.js';
import { listVideoIds } from '../domain/video.js';
import { loadRubric } from '../text/rubrics.js';
import { defaultWorkflowDirs, loadPacks } from '../workflow/packs.js';

/** G3 (D11 mục 4): sửa lớn khi số từ khác ≥ 10% số từ bản duyệt. */
export const MAJOR_EDIT_RATIO = 0.1;

const words = (s: string) => s.split(/\s+/).filter(Boolean);

/** Tỉ lệ từ khác giữa hai văn bản: 1 − LCS / độ dài bản gốc (theo từ). */
export function wordDiffRatio(before: string, after: string): number {
  const a = words(before);
  const b = words(after);
  if (!a.length) return b.length ? 1 : 0;
  let prev = new Uint32Array(b.length + 1);
  let cur = new Uint32Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++)
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1]! + 1 : Math.max(prev[j]!, cur[j - 1]!);
    [prev, cur] = [cur, prev];
  }
  const lcs = prev[b.length]!;
  return (Math.max(a.length, b.length) - lcs) / a.length;
}

/** Nội dung có hash `h` của `rel` (bản hiện tại hoặc một bản sao lưu `.sf/backups/<ISO>/rel`). */
function contentByHash(videoDir: string, rel: string, h: string): string | undefined {
  const cur = path.join(videoDir, rel);
  const cands = [cur];
  const bk = path.join(videoDir, '.sf', 'backups');
  if (existsSync(bk))
    for (const d of readdirSync(bk)) {
      const f = path.join(bk, d, rel);
      if (existsSync(f) && statSync(f).isFile()) cands.push(f);
    }
  for (const f of cands) {
    if (!existsSync(f)) continue;
    const t = readFileSync(f, 'utf8');
    if (sha256(t) === h) return t;
  }
  return undefined;
}

export interface EvalVideo {
  video_id: string;
  created_at: string;
  producer_model: string | null;
  rubric_version: string | null;
  rounds: number;
  final_score: number | null;
  approved: boolean;
  /** Tỉ lệ từ sửa sau duyệt (null: không có bản duyệt/không tìm được nội dung duyệt). */
  edit_ratio: number | null;
  tokens: number;
}

export interface EvalRow {
  group: string;
  videos: number;
  approved_without_major_edit: number | null;
  avg_critic_score: number | null;
  avg_rounds: number | null;
  tokens_per_video: number;
}

const avg = (xs: number[]) =>
  xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 100) / 100 : null;

/** Số liệu eval theo video (D11 mục 4) cho bước có refine (mặc định `script`). */
export function evalVideos(
  channelDir: string,
  o: { step?: string; since?: string; appDataDir?: string } = {},
): EvalVideo[] {
  const step = o.step ?? 'script';
  const packs = loadPacks(defaultWorkflowDirs(o.appDataDir));
  const out: EvalVideo[] = [];
  for (const id of listVideoIds(channelDir)) {
    const v = path.join(channelDir, 'videos', id);
    const sf = path.join(v, 'state.json');
    if (!existsSync(sf)) continue;
    const st = JSON.parse(readFileSync(sf, 'utf8')) as VideoState;
    if (o.since && st.created_at < o.since) continue;
    const rdir = path.join(v, 'reviews', step);
    const rounds = existsSync(rdir)
      ? readdirSync(rdir)
          .filter((f) => /^round-\d+\.json$/.test(f))
          .map((f) => JSON.parse(readFileSync(path.join(rdir, f), 'utf8')) as ReviewRound)
          .sort((a, b) => a.round - b.round)
      : [];
    const last = rounds.at(-1);
    const decl = packs
      .find((p) => p.manifest.id === st.workflow?.id)
      ?.manifest.steps.find((s) => s.id === step);
    let rubric: string | null = null;
    if (decl?.refine?.rubric) {
      try {
        const r = loadRubric(decl.refine.rubric, { channelDir }) as { version?: unknown };
        rubric = `${decl.refine.rubric}@${String(r.version ?? '?')}`;
      } catch {
        rubric = `${decl.refine.rubric}@?`;
      }
    }
    const ap = st.approvals.find((a) => a.step_id === step && a.status === 'approved');
    let ratio: number | null = null;
    if (ap) {
      const [rel, h] = Object.entries(ap.artifact_hashes)[0] ?? [];
      const approvedText = rel && h ? contentByHash(v, rel, h) : undefined;
      const now =
        rel && existsSync(path.join(v, rel)) ? readFileSync(path.join(v, rel), 'utf8') : undefined;
      if (approvedText !== undefined && now !== undefined) ratio = wordDiffRatio(approvedText, now);
    }
    out.push({
      video_id: id,
      created_at: st.created_at,
      producer_model: last ? `${last.producer.provider}/${last.producer.model}` : null,
      rubric_version: rubric,
      rounds: rounds.length,
      final_score: last?.score ?? null,
      approved: Boolean(ap),
      edit_ratio: ratio,
      tokens: st.budget?.tokens_used ?? 0,
    });
  }
  return out;
}

/**
 * `sf eval compare --by producer_model|rubric_version` (D11 mục 4, FN-028): tỉ lệ duyệt không sửa lớn,
 * điểm critic trung bình, số vòng trung bình, token/video theo nhóm.
 */
export function evalCompare(
  channelDir: string,
  by: 'producer_model' | 'rubric_version',
  o: { step?: string; since?: string; appDataDir?: string } = {},
): EvalRow[] {
  const vids = evalVideos(channelDir, o).filter((v) => v.rounds > 0);
  const groups = new Map<string, EvalVideo[]>();
  for (const v of vids) {
    const k = v[by] ?? '(unknown)';
    groups.set(k, [...(groups.get(k) ?? []), v]);
  }
  return [...groups.entries()]
    .map(([group, xs]) => {
      const judged = xs.filter((x) => x.approved && x.edit_ratio !== null);
      return {
        group,
        videos: xs.length,
        approved_without_major_edit: judged.length
          ? Math.round(
              (judged.filter((x) => x.edit_ratio! < MAJOR_EDIT_RATIO).length / judged.length) * 100,
            ) / 100
          : null,
        avg_critic_score: avg(xs.flatMap((x) => (x.final_score === null ? [] : [x.final_score]))),
        avg_rounds: avg(xs.map((x) => x.rounds)),
        tokens_per_video: Math.round(xs.reduce((s, x) => s + x.tokens, 0) / xs.length),
      };
    })
    .sort((a, b) => a.group.localeCompare(b.group));
}
