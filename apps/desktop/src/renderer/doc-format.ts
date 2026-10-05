import { parse as parseYaml } from 'yaml';

/**
 * Phân tích tài liệu Markdown của dự án (BRIEF, SCRIPT, STORYBOARD, STORY, CAST, publish, frame.md) để
 * hiển thị đẹp (D3 mục 5.1: front matter + khối `sf-*` + văn xuôi). Hàm thuần.
 */
export type DocBlock =
  | { kind: 'heading'; level: number; text: string; beat?: boolean }
  | {
      kind: 'line';
      speaker: string;
      text: string;
      emotion?: string;
      direction?: string;
      pause?: number;
      tts?: string;
    }
  | { kind: 'data'; tag: string; data: unknown }
  | { kind: 'prose'; text: string }
  | { kind: 'code'; text: string };

export interface Doc {
  front: [string, unknown][];
  blocks: DocBlock[];
}

/** Thuộc tính trong chú thích `<!-- sf:line id=… speaker=… direction="…" -->`. */
export function commentAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([\w-]+)=("([^"]*)"|\S+)/g)) out[m[1]!] = m[3] ?? m[2]!;
  return out;
}

export function parseDoc(text: string): Doc {
  let body = text.replace(/\r\n/g, '\n');
  let front: [string, unknown][] = [];
  const fm = /^---\n([\s\S]*?)\n---\n?/.exec(body);
  if (fm) {
    try {
      const y = parseYaml(fm[1]!) as Record<string, unknown> | null;
      front = Object.entries(y ?? {});
    } catch {
      front = [['front matter', fm[1]]];
    }
    body = body.slice(fm[0].length);
  }
  const blocks: DocBlock[] = [];
  const lines = body.split('\n');
  let prose: string[] = [];
  const flush = () => {
    const t = prose.join('\n').trim();
    if (t) blocks.push({ kind: 'prose', text: t });
    prose = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const fence = /^```\s*([\w-]*)\s*$/.exec(l);
    if (fence) {
      flush();
      const code: string[] = [];
      for (i++; i < lines.length && !/^```\s*$/.test(lines[i]!); i++) code.push(lines[i]!);
      const tag = fence[1] ?? '';
      if (tag.startsWith('sf-')) {
        let data: unknown;
        try {
          data = parseYaml(code.join('\n'));
        } catch {
          data = code.join('\n');
        }
        blocks.push({ kind: 'data', tag, data });
      } else blocks.push({ kind: 'code', text: code.join('\n') });
      continue;
    }
    const h = /^(#{1,6})\s+(.*?)\s*(<!--\s*sf:beat[^>]*-->)?\s*$/.exec(l);
    if (h) {
      flush();
      blocks.push({
        kind: 'heading',
        level: h[1]!.length,
        text: h[2]!,
        ...(h[3] ? { beat: true } : {}),
      });
      continue;
    }
    const sl = /^<!--\s*sf:line\b(.*?)-->\s*$/.exec(l);
    if (sl) {
      flush();
      const a = commentAttrs(sl[1]!);
      const textLines: string[] = [];
      let tts: string | undefined;
      for (
        i++;
        i < lines.length &&
        lines[i]!.trim() &&
        !/^<!--\s*sf:line\b/.test(lines[i]!) &&
        !/^#{1,6}\s/.test(lines[i]!);
        i++
      ) {
        const tt = /^<!--\s*sf:tts\b(.*?)-->\s*$/.exec(lines[i]!);
        if (tt) tts = commentAttrs(tt[1]!).text;
        else textLines.push(lines[i]!);
      }
      i--;
      blocks.push({
        kind: 'line',
        speaker: a.speaker ?? 'narrator',
        text: textLines.join('\n'),
        ...(a.emotion ? { emotion: a.emotion } : {}),
        ...(a.direction ? { direction: a.direction } : {}),
        ...(a.pause_after_ms ? { pause: Number(a.pause_after_ms) } : {}),
        ...(tts ? { tts } : {}),
      });
      continue;
    }
    if (/^<!--[\s\S]*-->\s*$/.test(l)) continue; // chú thích kỹ thuật khác: ẩn
    prose.push(l);
  }
  flush();
  return { front, blocks };
}

/** Nhãn hiển thị cho khóa dữ liệu thường gặp. */
const LABELS: Record<string, string> = {
  title: 'Tiêu đề',
  status: 'Trạng thái',
  language: 'Ngôn ngữ',
  video_id: 'Video',
  target_duration_ms: 'Thời lượng mục tiêu',
  proposed_workflow: 'Workflow đề xuất',
  proposed_output_profile: 'Định dạng',
  source_video_id: 'Video nguồn',
  title_working: 'Tên tạm',
  approved_at: 'Đã duyệt lúc',
  mood: 'Không khí',
  setting: 'Bối cảnh',
  time_of_day: 'Thời điểm',
  look: 'Look',
  music: 'Nhạc',
  intent: 'Ý đồ hình',
  layers: 'Lớp',
  transition_in: 'Chuyển cảnh',
  line_ids: 'Lời',
  beat_ids: 'Beat',
  effects: 'Hiệu ứng',
  overlays: 'Overlay',
  lipsync: 'Khẩu hình',
  summary: 'Tóm tắt',
  characters: 'Nhân vật',
  beats: 'Diễn biến',
  tags: 'Thẻ',
  chapters: 'Chương',
  name: 'Tên',
  role: 'Vai',
  voice_id: 'Giọng',
  caption_color: 'Màu phụ đề',
  schema_version: 'Phiên bản',
};
export const labelOf = (k: string) => LABELS[k] ?? k;

/** Giá trị ngắn gọn để hiển thị (ms → giây, đối tượng → "k: v"). */
export function showValue(k: string, v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number' && /_ms$/.test(k)) {
    const s = Math.round(v / 1000);
    return s >= 60 ? `${Math.floor(s / 60)} phút ${s % 60 ? `${s % 60} s` : ''}`.trim() : `${s} s`;
  }
  if (Array.isArray(v))
    return v.map((x) => (typeof x === 'object' ? showValue('', x) : String(x))).join(', ');
  if (typeof v === 'object')
    return Object.entries(v as Record<string, unknown>)
      .map(([kk, vv]) => `${labelOf(kk)}: ${showValue(kk, vv)}`)
      .join(' · ');
  return String(v);
}
