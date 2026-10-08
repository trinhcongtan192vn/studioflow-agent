# 070 — Danh sách video dạng thẻ

## Vấn đề
Sidebar chỉ hiện `Tên (phase)` — phase thô (`briefing`/`workflow`), không thấy loại video, bước đang ở đâu, lỗi hay chờ duyệt, ảnh đại diện; không tìm được (Tan, 2026-10-08).

## Yêu cầu
- FR-WS-70-01 `video.list` trả thẻ `VideoCard`: `title`, `format` (dọc/ngang theo output profile), `status` (`failed` > `waiting` > `running` > `done` > `paused`; `briefing` trước khi chọn workflow), `steps {done,total}`, `current {id,title}` (bước cần chú ý, tên theo manifest), `thumbnail` (đường dẫn nếu có), `created_at`, `updated_at`. Trường cũ giữ nguyên.
- FR-UI-70-02 Thẻ: ảnh đại diện (khung dọc cho Shorts) hoặc icon, tiêu đề 2 dòng, badge Shorts/Dài, chấm + nhãn trạng thái có màu kèm tên bước, thanh tiến độ, "x/y bước · 5 giờ trước"; nút xóa hiện khi rê chuột.
- FR-UI-70-03 Nhóm "Cần bạn" (lỗi, chờ duyệt) · "Đang làm" · "Xong"; ô tìm (không dấu vẫn khớp) khi có > 4 video; nút + ở đầu danh sách.
- FR-UI-70-04 Thẻ cập nhật khi bước đổi trạng thái / agent trả lời xong.

## AC
- `video-card.test.ts` (core): trạng thái, tiến độ, bước hiện tại, loại, ảnh.
- `video-list-format.test.ts`: nhãn, nhóm, tìm không dấu, thời gian tương đối.
- UI test hiện có vẫn qua (`video-list`, `new-video`, `delete-video`).
