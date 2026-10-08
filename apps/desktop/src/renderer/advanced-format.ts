/** 085: tính năng nâng cao — nhãn, mô tả chi phí, giá trị ô chọn ở tầng video. */

export const ADVANCED = [
  {
    key: 'advanced.refine',
    label: 'Viết – chấm – sửa (refine)',
    hint: 'Một model khác chấm điểm kịch bản và tiêu đề rồi yêu cầu sửa, tối đa 2 vòng. Tắt: viết một lần, chỉ kiểm định dạng trên máy.',
  },
  {
    key: 'advanced.music',
    label: 'Nhạc nền',
    hint: 'Tự chọn nhạc trong kho kênh và kho app theo tâm trạng từng scene (chạy trên máy, không tốn token). Tắt: video không có nhạc nền.',
  },
  {
    key: 'advanced.reasoning',
    label: 'Model mạnh (reasoning)',
    hint: 'Kịch bản viết bằng Claude Opus. Tắt: DeepSeek nếu có khóa, không thì Claude Sonnet. Model đặt riêng ở Cài đặt → Model luôn được ưu tiên.',
  },
  {
    key: 'advanced.custom_frames',
    label: 'Frame tùy biến bằng AI',
    hint: 'Agent vẽ từng frame theo ý đồ storyboard (hình vẽ bằng code, chuyển động riêng) — tốn nhiều token nhất. Tắt: frame dựng từ mẫu có sẵn (chữ lớn, con số, hai vế, ảnh), không tốn token.',
  },
] as const;

export type AdvancedKey = (typeof ADVANCED)[number]['key'];
export type Flag = { value: boolean; source: string; inherited: boolean };

/** Ô chọn ở tầng video: theo kênh / bật / tắt. */
export type VideoChoice = 'inherit' | 'on' | 'off';

export function videoChoice(f: Flag): VideoChoice {
  if (f.source !== 'video') return 'inherit';
  return f.value ? 'on' : 'off';
}

export const choiceValue = (c: VideoChoice): boolean | null =>
  c === 'inherit' ? null : c === 'on';

export const inheritLabel = (f: Flag) => `Theo kênh (${f.inherited ? 'Bật' : 'Tắt'})`;

/** Tóm tắt một dòng cho tiêu đề khối: "Nâng cao: Nhạc nền" / "Nâng cao: tắt hết (chế độ gọn)". */
export function advancedSummary(flags: Partial<Record<AdvancedKey, Flag>>): string {
  const on = ADVANCED.filter((a) => flags[a.key]?.value).map((a) => a.label);
  return on.length ? `Nâng cao: ${on.join(', ')}` : 'Nâng cao: tắt hết (chế độ gọn)';
}

/** 092: bước (theo loại trong thư viện D6) chịu ảnh hưởng của từng tùy chọn. */
const AFFECTS: Record<AdvancedKey, string[]> = {
  'advanced.refine': ['script', 'storyboard', 'publish-meta'],
  'advanced.reasoning': ['script', 'storyboard', 'publish-meta'],
  'advanced.music': ['music'],
  'advanced.custom_frames': ['frame-build'],
};

export interface RerunStep {
  id: string;
  uses?: string;
  title: string;
  status: string;
}

export interface RerunHint {
  text: string;
  primary?: { step: string; label: string };
  /** Lựa chọn rẻ hơn (refine/reasoning: chỉ làm lại tiêu đề, mô tả). */
  secondary?: { step: string; label: string };
}

/**
 * 092 (FR-UI-92-03): đổi tùy chọn Nâng cao → chạy lại từ bước sớm nhất chịu ảnh hưởng đã chạy (bỏ qua cũng tính là
 * đã chạy). Chưa bước nào chạy → tự áp dụng khi tới bước đó. Workflow không có bước chịu ảnh hưởng → `null`.
 */
export function rerunHint(key: AdvancedKey, steps: readonly RerunStep[]): RerunHint | null {
  const hit = steps.filter((s) => s.uses && AFFECTS[key].includes(s.uses));
  if (!hit.length) return null;
  const ran = hit.find((s) => s.status !== 'pending');
  if (!ran) return { text: `Sẽ áp dụng khi chạy tới bước "${hit[0]!.title}".` };
  const later = steps.slice(steps.indexOf(ran) + 1).filter((s) => s.status !== 'pending').length;
  const meta = hit.find((s) => s.uses === 'publish-meta' && s.status !== 'pending');
  return {
    text: `Video này đã chạy qua bước "${ran.title}" với tùy chọn cũ. Để áp dụng, chạy lại từ bước đó${later ? ` — ${later} bước sau sẽ phải làm lại (kể cả các điểm duyệt)` : ''}.`,
    primary: { step: ran.id, label: `↻ Chạy lại từ "${ran.title}"` },
    ...(meta && meta !== ran
      ? { secondary: { step: meta.id, label: `Chỉ làm lại "${meta.title}"` } }
      : {}),
  };
}

/**
 * 092: gộp gợi ý khi đổi nhiều tùy chọn — bước sớm nhất thắng; nút phụ (chỉ tiêu đề) chỉ khi mọi tùy chọn đã đổi đều
 * dùng được nó.
 */
export function changedHint(
  changed: readonly AdvancedKey[],
  steps: readonly RerunStep[],
): (RerunHint & { title: string }) | null {
  const hints = changed.map((k) => rerunHint(k, steps)).filter((h): h is RerunHint => h !== null);
  if (!hints.length) return null;
  const pos = (h: RerunHint) =>
    h.primary ? steps.findIndex((s) => s.id === h.primary!.step) : Number.MAX_SAFE_INTEGER;
  const best = [...hints].sort((a, b) => pos(a) - pos(b))[0]!;
  const labels = ADVANCED.filter((a) => changed.includes(a.key)).map((a) => a.label);
  const secondary = hints.every((h) => h.secondary) ? best.secondary : undefined;
  return {
    title: `Đã đổi: ${labels.join(', ')}`,
    text: best.text,
    ...(best.primary ? { primary: best.primary } : {}),
    ...(secondary ? { secondary } : {}),
  };
}
