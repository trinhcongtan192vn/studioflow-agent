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
