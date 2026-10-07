import { resolveConfig } from '../config/resolve.js';

/** Ghi chú của approval engine tự duyệt ("Tự duyệt bước", 034 R2; tên mới từ 047). */
export const AUTO_APPROVAL_NOTE = 'Tự duyệt bước';
/** Ghi chú cũ (trước 047) trong state.json của video đã làm. */
const LEGACY_AUTO_APPROVAL_NOTE = 'Tự duyệt (chế độ tự động)';

export const isAutoApproval = (a: { note?: string }): boolean =>
  (a.note?.startsWith(AUTO_APPROVAL_NOTE) || a.note?.startsWith(LEGACY_AUTO_APPROVAL_NOTE)) ??
  false;

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
