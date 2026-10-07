import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { SessionContext } from '../contracts/types.js';
import { resolveConfig, setConfig } from '../config/resolve.js';
import type { WriteStore } from '../store/writer.js';
import { autopilotOf, isAutopilotVideo } from '../domain/autopilot.js';

export type PermissionKind =
  'overwrite_approved' | 'pinned_frame' | 'batch_gen' | 'paid_api' | 'render';

export interface PermissionRequest {
  request_id: string;
  session_id: string;
  tool: string;
  kind: PermissionKind;
  summary: string;
  estimate?: unknown;
}

export interface PermissionDecision {
  request_id: string;
  allow: boolean;
  /** "Luôn cho phép trong video này" — chỉ có tác dụng với batch_gen/paid_api (D5 mục 5.1). */
  always?: boolean;
}

const REMEMBERABLE: Partial<Record<PermissionKind, string>> = {
  batch_gen: 'policy.auto_approve.batch_gen',
  paid_api: 'policy.auto_approve.paid_api',
};

/**
 * Bus hỏi người dùng giữa tool (D4 mục 2.3, D5 mục 5.1): phát `permission.requested`, chờ
 * `decide()`; từ chối hoặc hết thời gian → false (tool trả E_PERMISSION_DECLINED).
 */
export class PermissionBus extends EventEmitter {
  private readonly pending = new Map<string, (d: PermissionDecision) => void>();

  constructor(
    private readonly opts: {
      timeoutMs: number;
      appDataDir?: string;
      storeFor: (channelDir: string) => WriteStore;
    },
  ) {
    super();
  }

  async ask(
    session: SessionContext,
    req: { tool: string; kind: PermissionKind; summary: string; estimate?: unknown },
  ): Promise<boolean> {
    // 034: chế độ tự động — sinh hàng loạt (miễn phí) không hỏi; API có phí/render vẫn hỏi
    if (
      req.kind === 'batch_gen' &&
      autopilotOf(session.channel_dir, session.video_id, this.opts.appDataDir).on
    )
      return true;
    const key = REMEMBERABLE[req.kind];
    if (key && session.video_id) {
      const r = resolveConfig(
        key,
        { channelDir: session.channel_dir, videoId: session.video_id },
        { appDataDir: this.opts.appDataDir },
      );
      if (r.value === true) return true;
    }
    const request: PermissionRequest = {
      request_id: randomUUID(),
      session_id: session.session_id,
      ...req,
    };
    // 052: video Autopilot chạy không có người — API có phí không chờ (không treo cả hàng đợi): người dùng
    // vẫn thấy yêu cầu, tool trả từ chối ngay, bộ chạy đỗ mục kế hoạch "cần xác nhận chi phí"
    if (req.kind === 'paid_api' && isAutopilotVideo(session.channel_dir, session.video_id)) {
      this.emit('permission.requested', request);
      this.emit('autopilot.blocked', { session, request });
      return false;
    }
    const decision = await new Promise<PermissionDecision | undefined>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(request.request_id);
        resolve(undefined);
      }, this.opts.timeoutMs);
      this.pending.set(request.request_id, (d) => {
        clearTimeout(timer);
        this.pending.delete(request.request_id);
        resolve(d);
      });
      this.emit('permission.requested', request);
    });
    if (!decision?.allow) return false;
    if (decision.always && key && session.video_id) {
      setConfig(this.opts.storeFor(session.channel_dir), key, true, {
        tier: 'video',
        videoId: session.video_id,
      });
    }
    return true;
  }

  /** `permission.decide`; trả false nếu không có yêu cầu đang chờ với id đó. */
  decide(d: PermissionDecision): boolean {
    const resolve = this.pending.get(d.request_id);
    if (!resolve) return false;
    resolve(d);
    return true;
  }
}
