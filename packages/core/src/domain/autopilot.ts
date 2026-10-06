import { resolveConfig } from '../config/resolve.js';

/** Ghi chú của approval engine tự duyệt ở chế độ tự động (034 R2). */
export const AUTO_APPROVAL_NOTE = 'Tự duyệt (chế độ tự động)';

export const isAutoApproval = (a: { note?: string }): boolean =>
  a.note?.startsWith(AUTO_APPROVAL_NOTE) ?? false;

/** `workflow.autopilot` + `workflow.key_approvals` đã giải theo tầng app → kênh → video (D3 7.2). */
export function autopilotOf(
  channelDir: string,
  videoId: string | undefined,
  appDataDir?: string,
): { on: boolean; keys: string[] } {
  const scope = { channelDir, ...(videoId ? { videoId } : {}) };
  const on = resolveConfig<boolean>('workflow.autopilot', scope, { appDataDir }).value === true;
  const keys = resolveConfig<string[]>('workflow.key_approvals', scope, { appDataDir }).value;
  return { on, keys: Array.isArray(keys) ? keys : [] };
}
