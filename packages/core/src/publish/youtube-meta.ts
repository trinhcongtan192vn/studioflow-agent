import type { CaptionGroups, CaptionOverrides } from '../contracts/types.js';

/** Dựng metadata YouTube từ `publish.md` + mô tả render (D4 9.6): giới hạn của YouTube, khai báo AI. */
export const YT_LIMITS = { TITLE: 100, DESCRIPTION_BYTES: 5000, TAGS_CHARS: 500 } as const;

/** YouTube không cho `<` `>` trong tiêu đề/mô tả. */
const clean = (s: string) => s.replace(/[<>]/g, '').replace(/\r\n?/g, '\n');

export function cutTitle(title: string): string {
  const t = clean(title).replace(/\s+/g, ' ').trim();
  return [...t].length <= YT_LIMITS.TITLE
    ? t
    : `${[...t]
        .slice(0, YT_LIMITS.TITLE - 1)
        .join('')
        .trimEnd()}…`;
}

/** Cắt mô tả theo byte UTF-8 (≤ 5000), không cắt giữa ký tự. */
export function cutDescription(text: string): string {
  let out = clean(text).trim();
  while (Buffer.byteLength(out, 'utf8') > YT_LIMITS.DESCRIPTION_BYTES)
    out = out.slice(
      0,
      -Math.max(1, Math.ceil((Buffer.byteLength(out, 'utf8') - YT_LIMITS.DESCRIPTION_BYTES) / 4)),
    );
  return out.trimEnd();
}

/** Thẻ: bỏ trùng/rỗng; tổng ký tự (kể cả dấu phẩy, và cặp nháy cho thẻ có khoảng trắng) ≤ 500. */
export function clampTags(tags: string[]): string[] {
  const out: string[] = [];
  let total = 0;
  for (const raw of tags) {
    const t = clean(raw).replace(/\s+/g, ' ').trim().slice(0, 100);
    if (!t || out.some((x) => x.toLowerCase() === t.toLowerCase())) continue;
    const cost = t.length + (t.includes(' ') ? 2 : 0) + (out.length ? 1 : 0);
    if (total + cost > YT_LIMITS.TAGS_CHARS) break;
    out.push(t);
    total += cost;
  }
  return out;
}

const clock = (ms: number): string => {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
    : `${m}:${String(ss).padStart(2, '0')}`;
};

/**
 * Khối chương cho mô tả ("0:00 Tiêu đề"). YouTube chỉ nhận chương khi có ≥ 3 mốc, mốc đầu đúng 0:00 và mỗi
 * chương ≥ 10 giây; không đủ điều kiện → rỗng. Mô tả đã có sẵn dòng "0:00 …" thì không thêm.
 */
export function chaptersBlock(
  chapters: { start_ms: number; title: string }[] | undefined,
  description: string,
): string {
  const cs = [...(chapters ?? [])].sort((a, b) => a.start_ms - b.start_ms);
  if (cs.length < 3 || cs[0]!.start_ms !== 0) return '';
  for (let i = 1; i < cs.length; i++) if (cs[i]!.start_ms - cs[i - 1]!.start_ms < 10_000) return '';
  if (/^\s*0:00\s/m.test(description)) return '';
  return cs.map((c) => `${clock(c.start_ms)} ${clean(c.title).trim()}`).join('\n');
}

export interface VideoMetadataInput {
  title: string;
  description: string;
  tags: string[];
  chapters?: { start_ms: number; title: string }[];
  /** Ngôn ngữ kênh (`vi`, `de`…). */
  language: string;
  /** Dự án API đã kiểm duyệt → mới được hẹn giờ công khai. */
  audited: boolean;
  /** Giờ công khai (chỉ dùng khi `audited`). */
  publishAt?: Date;
  /** 091: đăng ngay công khai (chỉ khi `audited`; không hẹn giờ). */
  publicNow?: boolean;
}

export interface VideoMetadata {
  snippet: {
    title: string;
    description: string;
    tags: string[];
    categoryId: string;
    defaultLanguage: string;
    defaultAudioLanguage: string;
  };
  status: {
    privacyStatus: 'private' | 'public';
    publishAt?: string;
    selfDeclaredMadeForKids: false;
    containsSyntheticMedia: true;
  };
}

export function buildVideoMetadata(i: VideoMetadataInput): VideoMetadata {
  const block = chaptersBlock(i.chapters, i.description);
  return {
    snippet: {
      title: cutTitle(i.title),
      description: cutDescription(block ? `${i.description.trim()}\n\n${block}` : i.description),
      tags: clampTags(i.tags),
      categoryId: '22',
      defaultLanguage: i.language,
      defaultAudioLanguage: i.language,
    },
    status: {
      privacyStatus: i.audited && i.publicNow ? 'public' : 'private',
      ...(i.audited && i.publishAt && !i.publicNow ? { publishAt: i.publishAt.toISOString() } : {}),
      selfDeclaredMadeForKids: false,
      // khai báo nội dung do AI tạo/biến đổi (yêu cầu của YouTube)
      containsSyntheticMedia: true,
    },
  };
}

const srtTime = (ms: number): string => {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3_600_000);
  const m = Math.floor((t % 3_600_000) / 60_000);
  const s = Math.floor((t % 60_000) / 1000);
  const f = t % 1000;
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)},${p(f, 3)}`;
};

/** `caption_groups.json` (+ chỉnh tay `caption-overrides.json`: thời gian/chữ từng nhóm) → SRT. Không có nhóm → rỗng. */
export function captionsToSrt(
  groups: CaptionGroups | undefined,
  overrides?: CaptionOverrides,
): string {
  if (!groups?.groups.length) return '';
  const cues = groups.groups
    .map((g) => {
      const o = overrides?.groups?.[g.id];
      return {
        start: o?.start_ms ?? g.start_ms,
        end: o?.end_ms ?? g.end_ms,
        text: (o?.text ?? g.text).trim(),
      };
    })
    .filter((c) => c.text && c.end > c.start)
    .sort((a, b) => a.start - b.start);
  return `${cues.map((c, i) => `${i + 1}\n${srtTime(c.start)} --> ${srtTime(c.end)}\n${c.text}\n`).join('\n')}`;
}
