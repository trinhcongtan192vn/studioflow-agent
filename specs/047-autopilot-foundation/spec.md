# 047 — Nền móng Autopilot (M6): phạm vi, kênh quản lý, cài đặt kênh, đổi tên 034

## Mục tiêu
Bắt đầu M6 Autopilot (PRD G6, FR-AP-01..14): app tự hành theo kênh. 047 đặt nền: cập nhật phạm vi tài liệu, danh sách kênh quản lý, cài đặt Autopilot theo kênh/app, chuyển Autopilot ↔ Manual; chưa tự sản xuất/đăng (049–057).

## Quyết định (Tan, 2026-10-07)
- 034 đổi tên **"Tự duyệt bước"**; **Autopilot** = chế độ kênh, bật thì Tự duyệt bước luôn bật.
- Đăng: riêng tư + hẹn giờ, cửa sổ phản đối Telegram (`publish.veto_hours`).
- Khung giờ máy làm việc đặt trong Cài đặt (mặc định 08:00–23:00); Autopilot dùng ~70% ngân sách Claude (`autopilot.budget_share`).

## Yêu cầu
- FR-AP-01: `managed_channels` (D3 6.2) — mở kênh lần đầu (kể cả mở sẵn lúc khởi động) → thêm; IPC `channels.managed{,.add,.remove}`; trang chủ "Kênh đang quản lý" với công tắc Autopilot từng kênh + "Tạm dừng Autopilot (mọi kênh)".
- FR-AP-02: khóa tầng kênh `autopilot.enabled|competitors|pillars|workflows|max_per_day`, `publish.platforms|slots|timezone|veto_hours` (D3 7.2); kiểm dạng giá trị (`checkAutopilotValue`); IPC `channel.autopilot.get/set`; hộp **Cài đặt kênh** (từ trang chủ và thanh kênh). Đối thủ nhập URL / @handle / `UC…` → `youtube.resolve_channel` (YouTube Data API, 1 đơn vị) → lưu ID, hiện tên/ảnh/người đăng ký.
- FR-AP-03: khóa tầng app `autopilot.paused|work_window|budget_share`, `publish.timezone|veto_hours`; mục **Autopilot** trong Cài đặt; `settings.set` kiểm dạng giá trị.
- Đổi tên nhãn 034 → "Tự duyệt bước" (ghi chú tự duyệt mới `Tự duyệt bước`, vẫn nhận ghi chú cũ).
- PRD/kiến trúc: bỏ "đăng YouTube tự động" khỏi ngoài phạm vi; thêm G6, M6, FR-AP-01..14, NFR-11, AC-M6-01..04.

## AC
- `autopilot-settings.test.ts`: kiểm giá trị đúng/sai, đọc/ghi tầng kênh, Autopilot ⇒ Tự duyệt bước, giải đối thủ (fetch giả).
- `host.test.ts`: kênh quản lý + cài đặt Autopilot qua IPC, giá trị sai bị từ chối.
- UI: Cài đặt kênh → bật Autopilot → trang chủ hiện kênh ở chế độ Autopilot.
