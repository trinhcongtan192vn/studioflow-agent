/** Cảnh báo khi đóng app còn việc chạy dở (045). Hàm thuần. */
export interface Activity {
  studio: { channel: string; video: string }[];
  steps: { channel: string; video: string; step_id: string; title: string }[];
  jobs: { kind: string; video?: string }[];
  chats: { channel: string; video: string }[];
  /** 052: video Autopilot đang làm dở. */
  autopilot?: { channel: string; video: string; item_id: string; title: string }[];
}

/** Dòng mô tả việc đang chạy; rỗng = đóng được ngay. */
export function activityLines(a: Activity): string[] {
  const out: string[] = [];
  if (a.studio.length)
    out.push(
      `Studio đang mở để sửa ${a.studio.length} video — thay đổi chưa lưu có thể mất; nên bấm "Lưu" hoặc đóng Studio trước.`,
    );
  for (const s of a.steps)
    out.push(`Bước "${s.title}" đang chạy (${s.video}) — sẽ dừng giữa chừng.`);
  // job thuộc bước đang chạy đã nêu ở trên; chỉ đếm
  if (a.jobs.length)
    out.push(
      `${a.jobs.length} việc nền đang chạy (${[...new Set(a.jobs.map((j) => j.kind))].slice(0, 3).join(', ')}).`,
    );
  if (a.chats.length) out.push('Agent đang trả lời trong khung chat.');
  for (const v of a.autopilot ?? [])
    out.push(`Autopilot đang làm video "${v.title}" — lần mở app sau sẽ làm tiếp.`);
  return out;
}
