import { readFileSync } from 'node:fs';
import type { ChannelConfig, DailyPlan, PlanItem } from '../contracts/types.js';
import { validateValue } from '../domain/validate.js';
import { createVideo, listVideoIds } from '../domain/video.js';
import { newId } from '../domain/ids.js';
import { SfError } from '../errors.js';
import type { WriteStore } from '../store/writer.js';
import { readPlan, PLAN_REMOVED_NOTE, type PlanWorkflow } from './plan.js';

export { PLAN_REMOVED_NOTE } from './plan.js';
export const PLAN_MANUAL_NOTE = 'Đã chuyển sang tạo video thủ công.';

function checkDate(date: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
    throw new SfError('E_SCHEMA_INVALID', 'Ngày kế hoạch không hợp lệ.');
}

function editable(item: PlanItem): void {
  if (!['planned', 'skipped'].includes(item.status) || item.video_id)
    throw new SfError('E_SCHEMA_INVALID', 'Mục đang hoặc đã tạo video; hãy mở video để tiếp tục.');
}

function save(store: WriteStore, plan: DailyPlan, by: string): void {
  plan.generated_at = new Date().toISOString();
  store.write(`autopilot/plans/${plan.date}.json`, `${JSON.stringify(plan, null, 2)}\n`, { by });
}

/** Soft deletion preserves topic history so a replan cannot immediately add it back. */
export function removePlanItem(store: WriteStore, o: { date: string; item_id: string }): PlanItem {
  checkDate(o.date);
  const plan = readPlan(store.root, o.date);
  const item = plan?.items.find((i) => i.id === o.item_id);
  if (!plan || !item) throw new SfError('E_ID_UNKNOWN', 'Không tìm thấy mục kế hoạch.');
  editable(item);
  item.status = 'skipped';
  item.note = PLAN_REMOVED_NOTE;
  save(store, plan, 'autopilot.plan.remove');
  return item;
}

/** Transfer exactly one planned topic to the normal manual workflow, never to the runner. */
export function createManualPlanVideo(
  store: WriteStore,
  o: { date: string; item_id: string; preview?: DailyPlan; installed: PlanWorkflow[] },
): { video_id: string; created: boolean; instruction: string } {
  checkDate(o.date);
  const channel = JSON.parse(readFileSync(store.abs('channel.json'), 'utf8')) as ChannelConfig;
  let plan = readPlan(store.root, o.date);
  let item = plan?.items.find((i) => i.id === o.item_id);
  if (!item && o.preview) {
    if (
      validateValue('DailyPlan', o.preview).length ||
      o.preview.date !== o.date ||
      o.preview.channel_id !== channel.id
    )
      throw new SfError('E_SCHEMA_INVALID', 'Bản xem thử không hợp lệ cho kênh và ngày này.');
    const selected = o.preview.items.find((i) => i.id === o.item_id);
    if (!selected) throw new SfError('E_ID_UNKNOWN', 'Không tìm thấy mục trong bản xem thử.');
    // A fresh preview can give the same topic another ID. The persisted item stays authoritative.
    item = plan?.items.find(
      (i) => i.candidate_id === selected.candidate_id || i.title === selected.title,
    );
    if (!item) {
      editable(selected);
      plan ??= { ...o.preview, items: [], notes: [] };
      item = structuredClone(selected);
      plan.items.push(item);
    }
  }
  if (!plan || !item) throw new SfError('E_ID_UNKNOWN', 'Không tìm thấy mục kế hoạch.');
  if (item.note === PLAN_REMOVED_NOTE)
    throw new SfError('E_SCHEMA_INVALID', 'Mục này đã bị xóa khỏi kế hoạch.');
  const workflow = o.installed.find((w) => w.id === item!.workflow_id);
  if (!workflow || !workflow.output_profiles.includes(item.output_profile))
    throw new SfError('E_SCHEMA_INVALID', 'Workflow hoặc dạng xuất của mục này chưa được cài đặt.');
  const instruction = [
    `[Tạo thủ công từ kế hoạch ${o.date}] Hãy bắt đầu tạo video theo yêu cầu sau.`,
    `Chủ đề: ${item.title}`,
    `Góc nhìn: ${item.angle}`,
    `Nguồn tham khảo: ${item.source.url ?? item.source.kind}`,
    `Workflow: ${item.workflow_id}; dạng xuất: ${item.output_profile}.`,
    `Ngôn ngữ nội dung và lời thoại: ${channel.language} (mặc định của kênh). Giữ language trong BRIEF.md.`,
    ...(item.source.url &&
    /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com|youtu\.be)\//i.test(item.source.url)
      ? [
          `Dùng youtube.video và youtube.transcript với URL ${item.source.url} để phân tích video tham khảo theo luồng hiện có trước khi lên brief/kịch bản.`,
        ]
      : [
          'Nguồn này không có URL YouTube: nghiên cứu chủ đề theo nguồn đã nêu; không giả định có transcript video.',
        ]),
    'Phân tích nguồn nếu có, viết BRIEF.md rồi đề xuất workflow bằng workflow.select. Đây là luồng thủ công: giữ các điểm duyệt của người dùng, không tự duyệt và không tự đăng video.',
  ].join('\n');
  if (item.status === 'skipped' && item.video_id && item.note === PLAN_MANUAL_NOTE) {
    // Heal an interrupted transfer, using the already-reserved video ID.
    if (!listVideoIds(store.root).includes(item.video_id)) {
      createVideo(store, { id: item.video_id, title: item.title });
      store.write(
        `videos/${item.video_id}/BRIEF.md`,
        `${readFileSync(store.abs(`videos/${item.video_id}/BRIEF.md`), 'utf8')}${instruction}\n`,
        { by: 'autopilot.plan.create_video' },
      );
      return { video_id: item.video_id, created: true, instruction };
    }
    return { video_id: item.video_id, created: false, instruction };
  }
  editable(item);
  const video_id = newId('vd', new Set(listVideoIds(store.root))) as NonNullable<
    PlanItem['video_id']
  >;
  // Claim synchronously before the first agent turn, preventing the runner from taking this item.
  item.status = 'skipped';
  item.video_id = video_id;
  item.note = PLAN_MANUAL_NOTE;
  save(store, plan, 'autopilot.plan.create_video');
  createVideo(store, { id: video_id, title: item.title });
  const rel = `videos/${video_id}/BRIEF.md`;
  store.write(rel, `${readFileSync(store.abs(rel), 'utf8')}${instruction}\n`, {
    by: 'autopilot.plan.create_video',
  });
  return { video_id, created: true, instruction };
}
