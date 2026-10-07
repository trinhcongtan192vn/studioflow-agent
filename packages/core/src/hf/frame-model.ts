import type { FramePacket } from '../contracts/types.js';

/**
 * 060: chọn model cho phiên dựng frame — frame đơn giản (ít layer, không khẩu hình, không bản đồ/biểu đồ,
 * ngắn) dùng model rẻ (`frame_build.model_simple`, mặc định Haiku); frame phức tạp và lần thử lại dùng model
 * chính (`frame_build.model`). Dựng frame là bước tốn token Claude nhất.
 */
const COMPLEX =
  /(bản đồ|biểu đồ|sơ đồ|dòng thời gian|so sánh|đồ thị|infographic|map|chart|diagram|timeline|graph|comparison)/i;

export const SIMPLE_MAX_LAYERS = 3;
export const SIMPLE_MAX_MS = 10_000;

/** Frame đủ đơn giản cho model rẻ. */
export function isSimpleFrame(p: FramePacket): boolean {
  const f = p.frame as FramePacket['frame'] & {
    intent?: string;
    lipsync?: unknown;
    layers?: { notes?: string; kind?: string }[];
  };
  const layers = f.layers ?? [];
  const text = [f.intent ?? '', ...layers.map((l) => l.notes ?? '')].join(' ');
  return (
    layers.length <= SIMPLE_MAX_LAYERS &&
    !f.lipsync &&
    !layers.some((l) => l.kind === 'mouth') &&
    !COMPLEX.test(text) &&
    p.timing.duration_ms <= SIMPLE_MAX_MS &&
    !p.pinned_delta
  );
}

/** Model cho lần thử `attempt` (1-based): lần đầu frame đơn giản → model rẻ (nếu bật); còn lại → model chính. */
export function frameModel(
  p: FramePacket,
  attempt: number,
  cfg: { model: string; simple: string | null | undefined },
): { model: string; simple: boolean } {
  const simple = Boolean(cfg.simple) && attempt === 1 && isSimpleFrame(p);
  return { model: simple ? cfg.simple! : cfg.model, simple };
}
