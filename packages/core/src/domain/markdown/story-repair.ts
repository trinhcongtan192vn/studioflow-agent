import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

/**
 * Khối `sf-story` do model viết: câu có dấu `: ` không đặt trong ngoặc (`- Maya cheers: "So blue…"`) thành cặp
 * khóa–giá trị trong YAML → ghép lại thành chuỗi và ghi lại YAML (thư viện tự đặt ngoặc). Khối đọc không được
 * giữ nguyên để kiểm schema báo lỗi.
 */
export function repairStoryBlocks(text0: string): string {
  // khối cuối thiếu rào đóng (model dừng ngay trước ```) → đóng lại
  const text = (text0.match(/^```/gm) ?? []).length % 2 ? `${text0.trimEnd()}\n${'```'}\n` : text0;
  const str = (x: unknown): string =>
    typeof x === 'string'
      ? x
      : x && typeof x === 'object' && !Array.isArray(x)
        ? Object.entries(x)
            .map(([k, v]) => `${k}: ${str(v)}`)
            .join('; ')
        : String(x ?? '');
  return text.replace(/```sf-story\n([\s\S]*?)\n```/g, (all, body: string) => {
    let data: unknown;
    try {
      data = parseYaml(body);
    } catch {
      return all;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return all;
    const d = data as Record<string, unknown>;
    let changed = false;
    for (const k of ['beats', 'characters'])
      if (Array.isArray(d[k]) && d[k].some((x) => typeof x !== 'string')) {
        d[k] = d[k].map(str);
        changed = true;
      }
    for (const k of ['title', 'summary', 'setting'])
      if (d[k] !== undefined && typeof d[k] !== 'string') {
        d[k] = str(d[k]);
        changed = true;
      }
    return changed ? `\`\`\`sf-story\n${stringifyYaml(d).trimEnd()}\n\`\`\`` : all;
  });
}
