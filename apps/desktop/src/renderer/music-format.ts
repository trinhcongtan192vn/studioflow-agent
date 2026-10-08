/** 084: định dạng tab Nhạc — nhãn kho, tiến độ và kết quả một lần nạp. */

export type MusicScope = 'channel' | 'app';

export const SCOPE_LABEL: Record<MusicScope, string> = { channel: 'Kênh', app: 'App' };

/** "Đang nạp 123/1000 bài (12%)". */
export function importProgress(done: number, total: number): string {
  if (!total) return 'Đang chuẩn bị…';
  return `Đang nạp ${done}/${total} bài (${Math.floor((done / total) * 100)}%)`;
}

/** Kết quả nạp: bài mới / đã có sẵn (trùng nội dung) / bỏ qua kèm lý do đầu tiên. */
export function importSummary(
  result: { track_ids: string[]; skipped: { file: string; reason: string }[] },
  before: ReadonlySet<string>,
  scope: MusicScope,
): string {
  const ids = [...new Set(result.track_ids)];
  const added = ids.filter((id) => !before.has(id)).length;
  const dup = result.track_ids.length - added;
  const parts = [`Đã nạp ${added} bài mới vào kho ${SCOPE_LABEL[scope].toLowerCase()}`];
  if (dup) parts.push(`${dup} bài đã có sẵn`);
  if (result.skipped.length)
    parts.push(
      `bỏ qua ${result.skipped.length} file (ví dụ ${baseName(result.skipped[0]!.file)}: ${result.skipped[0]!.reason})`,
    );
  return `${parts.join(' · ')}.`;
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}
