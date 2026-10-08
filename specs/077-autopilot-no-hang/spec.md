# 077 — Autopilot không treo: xác nhận quyết ngay, ComfyUI có hạn chờ

## Vấn đề (rà soát luồng Autopilot, 2026-10-08)
Autopilot làm lần lượt từng video, nên một chỗ treo chặn cả hàng đợi.
- Video Autopilot không có người trả lời, nhưng yêu cầu xác nhận ngoài "API có phí" (ghi đè bản đã duyệt, frame đã ghim, render) vẫn chờ người tới 10 phút rồi mới từ chối; agent hỏi nhiều lần → treo hàng chục phút, bước lỗi.
- `ComfyClient.wait` thăm dò `/history` không giới hạn thời gian — ComfyUI kẹt (VRAM/driver) → Autopilot đứng mãi.

## Yêu cầu
- FR-AP-77-01 Video Autopilot (`state.autopilot`): `overwrite_approved` và `render` → cho phép ngay (bản đã duyệt luôn được sao lưu trước khi ghi đè); `pinned_frame` → từ chối ngay (giữ phần người dùng sửa tay). Sự kiện `autopilot.decided` → nhật ký `permission.auto`. `paid_api` giữ như 052.
- FR-AP-77-02 `ComfyClient.wait` có hạn (`timeoutMs`, mặc định 15 phút/ảnh): quá hạn → hủy lệnh (`/interrupt` + xóa khỏi hàng đợi), lỗi `E_PROVIDER_FAILED` (thử lại được); provider ảnh dừng ComfyUI để lần sau khởi động lại sạch.

## AC
- `autopilot.test.ts`: video Autopilot — ghi đè cho, frame ghim từ chối, render cho, không phát `permission.requested`, không chờ.
- `comfy-wait-timeout.test.ts`: máy chủ giả không trả ảnh → lỗi sau hạn, đã gửi `/interrupt` + `/queue`.
