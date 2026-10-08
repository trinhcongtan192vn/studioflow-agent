import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { VideoState } from '../contracts/types.js';
import { loadOutputProfile } from '../hf/outputs.js';

/** 070: trạng thái gọn của một video cho thẻ ở sidebar. */
export type VideoStatus = 'briefing' | 'running' | 'waiting' | 'failed' | 'done' | 'paused';

export interface VideoCard {
  id: string;
  title: string;
  phase: VideoState['phase'];
  created_at: string;
  updated_at: string;
  /** Dọc (Shorts) / ngang; chưa chọn output profile → `null`. */
  format: 'vertical' | 'horizontal' | null;
  status: VideoStatus;
  /** Bước xong (kể cả bỏ qua) / tổng số bước. */
  steps: { done: number; total: number };
  /** Bước cần chú ý: lỗi > chờ duyệt > đang chạy > bước kế tiếp chưa làm. */
  current?: { id: string; title: string };
  /** Đường dẫn tuyệt đối `thumbnail.jpg|png` nếu có. */
  thumbnail?: string;
}

const ORDER: [VideoStatus, string[]][] = [
  ['failed', ['failed']],
  ['waiting', ['waiting_approval']],
  ['running', ['running']],
];

export function videoStatus(
  phase: VideoState['phase'],
  steps: Record<string, { status: string }>,
): VideoStatus {
  if (phase !== 'workflow') return 'briefing';
  const all = Object.values(steps).map((s) => s.status);
  for (const [st, keys] of ORDER) if (all.some((x) => keys.includes(x))) return st;
  return all.length && all.every((x) => x === 'done' || x === 'skipped') ? 'done' : 'paused';
}

function titleOf(channel: string, id: string): string {
  const brief = path.join(channel, 'videos', id, 'BRIEF.md');
  if (!existsSync(brief)) return '';
  return (
    /title_working:\s*(.*)/
      .exec(readFileSync(brief, 'utf8'))?.[1]
      ?.trim()
      .replace(/^['"]|['"]$/g, '') ?? ''
  );
}

/**
 * Thẻ của video `id`; không có `state.json` → `undefined`. `stepTitles(workflowId)` cho tên bước theo
 * manifest (workflow chưa cài → `undefined`, dùng mã bước).
 */
export function videoCard(
  channel: string,
  id: string,
  stepTitles: (workflowId: string) => Record<string, string> | undefined,
): VideoCard | undefined {
  const vdir = path.join(channel, 'videos', id);
  const f = path.join(vdir, 'state.json');
  if (!existsSync(f)) return undefined;
  const st = JSON.parse(readFileSync(f, 'utf8')) as VideoState;
  const steps = st.phase === 'workflow' ? (st.steps ?? {}) : {};
  const entries = Object.entries(steps);
  const status = videoStatus(st.phase, steps);
  let format: VideoCard['format'] = null;
  if (st.output_profile)
    try {
      const p = loadOutputProfile(st.output_profile);
      format = p.height > p.width ? 'vertical' : 'horizontal';
    } catch {
      format = /shorts|1080x1920|vertical/i.test(st.output_profile) ? 'vertical' : 'horizontal';
    }
  const pick =
    entries.find(([, s]) => s.status === 'failed') ??
    entries.find(([, s]) => s.status === 'waiting_approval') ??
    entries.find(([, s]) => s.status === 'running') ??
    entries.find(([, s]) => s.status === 'pending' || s.status === 'stale');
  const titles = st.workflow?.id ? stepTitles(st.workflow.id) : undefined;
  const thumb = ['thumbnail.jpg', 'thumbnail.png'].map((n) => path.join(vdir, n)).find(existsSync);
  return {
    id,
    title: titleOf(channel, id) || id,
    phase: st.phase,
    created_at: st.created_at,
    updated_at: st.updated_at,
    format,
    status,
    steps: {
      done: entries.filter(([, s]) => s.status === 'done' || s.status === 'skipped').length,
      total: entries.length,
    },
    ...(pick && status !== 'done'
      ? { current: { id: pick[0], title: titles?.[pick[0]] ?? pick[0] } }
      : {}),
    ...(thumb ? { thumbnail: thumb } : {}),
  };
}
