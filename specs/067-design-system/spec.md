# 067 — Hệ thiết kế: giao diện tối kiểu studio, token, icon, chọn giao diện

## Vấn đề
Giao diện đơn điệu: vài biến màu, nút viền xám như nhau, icon là emoji (⚙ 🗑 ▶), màu gõ cứng rải rác, tối/sáng chỉ theo Windows (Tan, 2026-10-08). Tan chọn: **studio tối chuyên nghiệp** mặc định, vẫn có chế độ sáng.

## Yêu cầu
- FR-UI-67-01 Token trong `styles.css`: bề mặt (`--bg/--panel/--panel-2/--field`), chữ/viền, nhấn + trạng thái (`--ok/--warn/--caution/--violet` + `-bg/-ink`), bóng, khoảng cách `--s1..6`, bo góc `--r-*`, cỡ chữ `--fs-*`. Không còn màu gõ cứng ngoài khối token.
- FR-UI-67-02 Mặc định tối; `<html data-theme="light|system">` đổi sang sáng / theo Windows. Cài đặt → Giao diện: Tối · Sáng · Theo Windows, đổi ngay, nhớ theo máy (`localStorage`, lỗi → tối).
- FR-UI-67-03 Thành phần cơ bản: nút (thường, `primary`, `ghost`, `danger`, `icon-only`), ô nhập, thẻ, modal (nền mờ), tab gạch chân, badge/chip bo tròn, nhóm chọn một (`segmented`), vòng focus, thanh cuộn mảnh.
- FR-UI-67-04 Icon SVG nội tuyến `Icon.tsx` (đóng gói, không tải mạng) thay emoji ở sidebar.

## AC
- `theme.test.ts`: mặc định tối, đọc/ghi lựa chọn, không có localStorage → tối.
- `styles.test.ts`: không có mã màu hex/rgb ngoài khối token đầu file.
- UI test hiện có vẫn qua (giữ `data-testid`).
