import type { SessionContext } from '../contracts/types.js';
import type { WriteStore } from '../store/writer.js';
import type { PermissionBus } from './permission.js';

/** Tùy chọn theo lời gọi (chủ yếu cho test). */
export interface CallOptions {
  scriptTimeoutMs?: number;
}

export interface ToolContext {
  session: SessionContext;
  store: WriteStore;
  permissions: PermissionBus;
  appDataDir?: string;
  opts: CallOptions;
}

/** Tham số `channel` cho tool vận hành dùng được trong phiên `ops` (055, D4 mục 2.2): đường dẫn hoặc tên kênh. */
export const OPS_CHANNEL_PROP = {
  channel: {
    type: 'string',
    description:
      'Chỉ cho phiên ops: tên hoặc đường dẫn của kênh quản lý đang bật Autopilot (bắt buộc khi có nhiều kênh).',
  },
} as const;

/** Tool của Gateway (D4 mục 2.4). Loại phiên được phép lấy từ bảng D5 mục 4 (policy.ts). */
// `any`: registry giữ tool có kiểu đầu vào khác nhau; đầu vào đã được Ajv kiểm trước handler.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ToolDefinition<I = any, O = unknown> {
  /** Tên logic `nhóm.tên`; tên MCP thay `.` bằng `_` (D4 mục 2.1). */
  name: string;
  description: string;
  /** JSON Schema của đầu vào (`type: 'object'`). */
  input: Record<string, unknown>;
  /** Handler trả `{job_id}` → đặt `ToolResult.job_id` (việc chạy nền, D4 mục 2.3). */
  returnsJob?: boolean;
  handler(input: I, ctx: ToolContext): Promise<O>;
}
