import type { AssetManifest, MusicTrack } from '../contracts/types.js';

/**
 * Nội dung `CREDITS.txt` (D8 mục 4, định dạng FN-012/021): chỉ bài/asset đã dùng có `attribution`;
 * không có mục nào → chuỗi rỗng (không tạo file).
 */
export function buildCredits(tracks: MusicTrack[], assets: AssetManifest['assets'] = []): string {
  const music = tracks.filter((t) => t.attribution?.trim());
  const images = assets.filter((a) =>
    (a.source as { attribution?: string } | undefined)?.attribution?.trim(),
  );
  const parts: string[] = [];
  if (music.length) {
    parts.push(
      'Music:',
      ...music.flatMap((t) => [
        `"${t.title ?? t.original_name}"${t.artist ? ` — ${t.artist}` : ''}`,
        t.attribution!.trim(),
        ...(t.url ? [t.url] : []),
        '',
      ]),
    );
  }
  if (images.length) {
    parts.push(
      'Images:',
      ...images.flatMap((a) => [(a.source as { attribution: string }).attribution.trim(), '']),
    );
  }
  return parts.length ? `${parts.join('\n').trimEnd()}\n` : '';
}
