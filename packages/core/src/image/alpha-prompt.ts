/**
 * Ảnh trong suốt sinh thẳng bằng Qwen RGBA (`t2i_rgba`, Tan 2026-10-10: không thêm bước tách nền ngoài). Chế độ
 * này chỉ cho nền trong suốt khi prompt không tả một cái nền: phong cách kênh "on aged paper", "plain background",
 * "on the deck"… làm model vẽ luôn giấy/sàn (vd_bjoza2qu). Bỏ các cụm đó và chặn nền bằng prompt phủ định.
 */
const BACKGROUNDISH =
  /\b(paper|parchment|canvas|backdrop|background|vignette|scenery|landscape|wallpaper|texture(?:d)? (?:paper|ground)|floor|ground|deck|table ?top|on the (?:ground|floor|deck|table))\b/i;

export const ALPHA_NEGATIVE =
  'background, backdrop, paper, parchment, paper texture, canvas, frame, border, floor, ground, deck, table, scenery, landscape, room, sky, cast shadow on the ground';

/** "on the deck", "on aged paper", "against a white wall"… — cắt riêng cụm chỉ nơi chốn, giữ phần tả chủ thể. */
const ON_SURFACE =
  /\s*\b(?:on|upon|against|over|across|in front of)\s+(?:an?\s+|the\s+)?(?:[\w-]+\s+){0,3}(?:paper|parchment|canvas|background|backdrop|floor|ground|deck|table|wall|planks?|grass|sand)\b/gi;

export function alphaPrompt(prompt: string): string {
  const parts = prompt
    .split(',')
    .map((p) => p.replace(ON_SURFACE, '').trim())
    .filter((p) => p && !BACKGROUNDISH.test(p));
  return [...parts, 'isolated subject only, cut-out, nothing behind it'].join(', ');
}

export function alphaNegative(negative?: string): string {
  return negative?.trim() ? `${negative.trim()}, ${ALPHA_NEGATIVE}` : ALPHA_NEGATIVE;
}
