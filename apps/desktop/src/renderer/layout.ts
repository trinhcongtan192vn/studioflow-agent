/** Độ rộng cột của không gian kênh (FN-008 mục 1): sidebar | chat | tab phải, kéo được. Hàm thuần. */
export interface PanelWidths {
  left: number;
  right: number;
}

export const DEFAULT_WIDTHS: PanelWidths = { left: 260, right: 420 };
export const LIMITS = { leftMin: 180, leftMax: 520, rightMin: 300, centerMin: 360, splitter: 6 };

/** Giữ cột trong giới hạn; khung chat ở giữa luôn còn ít nhất `centerMin`. */
export function clampWidths(w: PanelWidths, total: number): PanelWidths {
  const left = Math.round(Math.min(Math.max(w.left, LIMITS.leftMin), LIMITS.leftMax));
  const rightMax = Math.max(LIMITS.rightMin, total - left - LIMITS.centerMin - 2 * LIMITS.splitter);
  const right = Math.round(Math.min(Math.max(w.right, LIMITS.rightMin), rightMax));
  return { left, right };
}

/** Kéo thanh chia `side` thêm `dx` px (dương = sang phải). */
export function dragWidths(
  w: PanelWidths,
  side: 'left' | 'right',
  dx: number,
  total: number,
): PanelWidths {
  return clampWidths(
    side === 'left' ? { ...w, left: w.left + dx } : { ...w, right: w.right - dx },
    total,
  );
}

const KEY = 'sf.layout.widths';

export function loadWidths(): PanelWidths {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<PanelWidths> | null;
    if (v && typeof v.left === 'number' && typeof v.right === 'number')
      return { left: v.left, right: v.right };
  } catch {
    /* không đọc được bộ nhớ trình duyệt → mặc định */
  }
  return DEFAULT_WIDTHS;
}

export function saveWidths(w: PanelWidths): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(w));
  } catch {
    /* bỏ qua */
  }
}
