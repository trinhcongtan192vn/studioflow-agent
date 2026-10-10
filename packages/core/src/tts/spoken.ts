/** Chuẩn hóa để so: chữ thường, bỏ dấu câu, gộp khoảng trắng. */
const norm = (s: string) =>
  s
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const words = (s: string) => (s ? s.split(' ').length : 0);

/**
 * Chữ TTS đọc cho một line: `tts_text` chỉ là cách đọc khác của **chính line đó** (số → chữ, tên riêng). Model
 * viết kịch bản có lúc gộp cả câu trước vào `sf:tts` để đọc liền mạch → giọng đọc lặp, lệch phụ đề, ASR vẫn
 * "khớp" vì chấm theo `tts_text` (vd_bjoza2qu). Bỏ `tts_text` khi nó chứa chữ của line khác hoặc dài hơn hẳn
 * chữ hiển thị → đọc đúng chữ của line.
 */
export function spokenText(
  line: { id: string; text: string; tts_text?: string },
  lines: readonly { id: string; text: string }[],
): string {
  const tts = line.tts_text?.trim();
  if (!tts) return line.text;
  const t = norm(tts);
  const own = norm(line.text);
  // số viết thành chữ làm câu dài ra (71% → seventy-one percent), nhưng không gấp đôi
  if (words(t) > Math.ceil(words(own) * 1.6) + 4) return line.text;
  for (const o of lines) {
    if (o.id === line.id) continue;
    const other = norm(o.text);
    if (words(other) >= 3 && t.includes(other) && !own.includes(other)) return line.text;
  }
  return tts;
}
