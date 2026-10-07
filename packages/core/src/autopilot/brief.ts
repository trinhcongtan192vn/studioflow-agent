import type { PlanItem } from '../contracts/types.js';

/** Brief do bộ chạy Autopilot giao cho phiên `main` của video (đã tạo, đang ở pha briefing). */
export type BriefFn = (channel: string, video: string, item: PlanItem) => Promise<void>;

const YOUTUBE = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i;
const KIND_TEXT: Record<PlanItem['source']['kind'], string> = {
  competitor: 'video đối thủ vừa nổi',
  competitor_evergreen: 'video đối thủ có tuổi thọ dài',
  trending: 'video đang thịnh hành',
  trend: 'xu hướng tìm kiếm',
  news: 'tin nóng',
};

/**
 * Chỉ dẫn "lên brief" gửi phiên `main` (052, FR-AP-07): không có người xem nên agent tự quyết, ghi
 * `REFERENCE.md` (khi có video nguồn) + `BRIEF.md` mục "Công thức tham khảo", rồi `workflow.select` đúng
 * workflow/dạng xuất của kế hoạch — cổng chất lượng so khớp đề xuất này với kế hoạch (duyệt brief).
 */
export function briefInstruction(item: PlanItem, date: string): string {
  const url = item.source.url;
  const hasVideo = Boolean(url && YOUTUBE.test(url));
  const from = item.source.source_channel ? ` của kênh ${item.source.source_channel.title}` : '';
  return [
    `[Autopilot] Lên brief cho video "${item.title}" (kế hoạch ngày ${date}). Không có người xem lúc này: tự quyết, không hỏi lại người dùng.`,
    `- Chủ đề: ${item.title}`,
    `- Góc nhìn: ${item.angle}`,
    `- Nguồn: ${KIND_TEXT[item.source.kind]}${from}${url ? ` — ${url}` : ''}`,
    `- Workflow và dạng xuất đã chọn trong kế hoạch: ${item.workflow_id} / ${item.output_profile} (giữ đúng, không đổi).`,
    '',
    'Làm lần lượt:',
    ...(hasVideo
      ? [
          `1. Theo mục "Tạo video từ video YouTube tham khảo" của skill studioflow: youtube.video và youtube.transcript cho ${url}, phân tích công thức (why it works, how to reproduce) và ghi REFERENCE.md. Không có transcript thì phân tích từ tiêu đề/mô tả/tags. Học công thức, không sao chép nội dung.`,
        ]
      : [
          '1. Nguồn là chủ đề/tin (không có video nguồn): phân tích chủ đề và góc nhìn ở trên; cần số liệu thì dùng research.get hoặc youtube.search. Không có video nguồn nên không có bước phân tích video.',
        ]),
    `2. Ghi BRIEF.md (artifact.write): tiêu đề làm việc, đối tượng, hook, cấu trúc dự kiến, thời lượng mục tiêu phù hợp dạng xuất${hasVideo ? ', cùng mục "Công thức tham khảo" (Winning formula, Best angle, hook mở đầu — tóm từ REFERENCE.md, kèm URL nguồn)' : ''}. Nội dung, ví dụ và câu chữ phải là của kênh.`,
    `3. Gọi workflow.select {workflow_id: "${item.workflow_id}", output_profile: "${item.output_profile}"}. App tự duyệt brief khi đề xuất khớp kế hoạch; không nhắc người dùng bấm Duyệt.`,
    '4. Báo ngắn gọn trong chat khi xong (một hai dòng).',
  ].join('\n');
}
