import { existsSync, readFileSync } from 'node:fs';
import { registerObjective } from './gates.js';

/**
 * 061: render phát hành chặn line ASR còn `mismatch` — báo sớm ở `finalize` (kiểm mềm `asr_clean`) để người
 * dùng nghe lại và chấp nhận / sửa trước khi chờ render. Chi tiết nêu id line và tỉ lệ lỗi (giao diện đọc id).
 */
export function asrCleanCheck(
  abs: (rel: string) => string,
  videoId: string,
): { pass: boolean; detail?: string; lines: { line_id: string; wer: number }[] } {
  const f = abs(`videos/${videoId}/audio_meta.json`);
  if (!existsSync(f)) return { pass: true, lines: [] };
  const meta = JSON.parse(readFileSync(f, 'utf8')) as {
    lines?: { line_id: string; asr_flag?: string; asr_wer?: number }[];
  };
  const bad = (meta.lines ?? [])
    .filter((l) => l.asr_flag === 'mismatch')
    .map((l) => ({ line_id: l.line_id, wer: l.asr_wer ?? 1 }));
  if (!bad.length) return { pass: true, lines: [] };
  return {
    pass: false,
    lines: bad,
    detail: `${bad.length} line(s) misread: ${bad
      .map((l) => `${l.line_id} (${Math.round(l.wer * 100)}%)`)
      .join(', ')} — listen and asr.accept, or fix the text`,
  };
}

registerObjective('asr_clean', (ctx) => {
  const r = asrCleanCheck((rel) => ctx.store.abs(rel), ctx.videoId);
  return r.pass ? { pass: true } : { pass: false, detail: r.detail! };
});
