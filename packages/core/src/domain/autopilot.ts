import { readFileSync } from 'node:fs';
import path from 'node:path';
import { resolveConfig } from '../config/resolve.js';

/** Ghi chú của approval engine tự duyệt ("Tự duyệt bước", 034 R2; tên mới từ 047). */
export const AUTO_APPROVAL_NOTE = 'Tự duyệt bước';
/** Ghi chú cũ (trước 047) trong state.json của video đã làm. */
const LEGACY_AUTO_APPROVAL_NOTE = 'Tự duyệt (chế độ tự động)';

/** Ghi chú của cổng chất lượng Autopilot (052): `Autopilot: <lý do>`; điểm chốt vẫn là approval "tự duyệt". */
export const AUTOPILOT_APPROVAL_NOTE = 'Autopilot:';
/** Ghi chú trên approval cổng chất lượng không duyệt (video đỗ chờ người, 052) — không phải tự duyệt. */
export const AUTOPILOT_PARK_NOTE = 'Cần người duyệt (Autopilot):';

export const isAutoApproval = (a: { note?: string }): boolean =>
  (a.note?.startsWith(AUTO_APPROVAL_NOTE) ||
    a.note?.startsWith(LEGACY_AUTO_APPROVAL_NOTE) ||
    a.note?.startsWith(AUTOPILOT_APPROVAL_NOTE)) ??
  false;

/** Video do Autopilot tạo (`state.autopilot`, D3 mục 4); đọc `state.json`, thiếu/hỏng → false (video làm tay). */
export function isAutopilotVideo(channelDir: string, videoId: string | undefined): boolean {
  if (!videoId) return false;
  try {
    const st = JSON.parse(
      readFileSync(path.join(channelDir, 'videos', videoId, 'state.json'), 'utf8'),
    ) as { autopilot?: unknown };
    return Boolean(st.autopilot);
  } catch {
    return false;
  }
}

/** "Tự duyệt bước" (`workflow.autopilot`, 034) + `workflow.key_approvals` đã giải theo tầng app → kênh → video (D3 7.2). */
export function autopilotOf(
  channelDir: string,
  videoId: string | undefined,
  appDataDir?: string,
): { on: boolean; keys: string[] } {
  const scope = { channelDir, ...(videoId ? { videoId } : {}) };
  // 047: kênh bật Autopilot (M6) → "Tự duyệt bước" luôn bật cho video của kênh
  const on =
    resolveConfig<boolean>('workflow.autopilot', scope, { appDataDir }).value === true ||
    resolveConfig<boolean>('autopilot.enabled', { channelDir }, { appDataDir }).value === true;
  const keys = resolveConfig<string[]>('workflow.key_approvals', scope, { appDataDir }).value;
  return { on, keys: Array.isArray(keys) ? keys : [] };
}
