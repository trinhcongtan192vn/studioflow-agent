# 073 — Thư viện, thông báo nổi, bảng lệnh Ctrl+K

## Vấn đề
Không có chỗ xem lại mọi video đã render để xem/xuất; việc của video khác (lỗi, chờ duyệt, xong) chỉ thấy khi mở đúng video đó; không có cách nhảy nhanh giữa video/trang (Tan, 2026-10-08, "bổ sung các màn còn thiếu").

## Yêu cầu
- FR-RD-73-01 `render.library` (ChannelRef): mọi bản render đã xong của các video trong kênh, mới nhất trước, kèm `video_id`, tiêu đề (`publish.md` → brief), loại, ảnh đại diện.
- FR-UI-73-02 Trang Thư viện (thanh điều hướng): lưới thẻ (ảnh, thời lượng, Phát hành/Nháp, Shorts/Dài, thời gian), lọc Tất cả/Phát hành/Nháp; bấm ảnh → phát video; Xuất… (hộp thoại 066 đúng bản render); mở thư mục; Mở video.
- FR-UI-73-03 Thông báo nổi (góc dưới phải, tự ẩn 8 s, tối đa 4): khi video **khác** video đang xem (hoặc đang ở trang khác) lỗi bước / chờ duyệt / làm xong — kèm nút "Mở video".
- FR-UI-73-04 Ctrl+K: bảng lệnh — trang, video (kèm trạng thái), tab, thao tác (tạo video, render nháp, xuất video đang mở); tìm không dấu, mọi từ phải khớp; ↑↓ Enter Esc.

## Để sau
Duyệt trước khi đăng (đã có trong Autopilot hôm nay / Telegram), trang tổng quan kênh, trình hướng dẫn lần đầu.

## AC
- `video-export.test.ts`: thư viện.
- `palette-format.test.ts`: thông báo nổi chỉ cho lỗi/chờ duyệt/xong; lọc lệnh.
- UI test: Thư viện trống; Ctrl+K "le loi" Enter → mở video.
