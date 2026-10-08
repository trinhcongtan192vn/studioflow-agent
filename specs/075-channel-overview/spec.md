# 075 — Tổng quan kênh

## Vấn đề
Không có màn nhìn nhanh tình hình kênh: bao nhiêu video cần mình, đang làm, xong, chờ đăng; số liệu YouTube; việc kế tiếp (Tan, 2026-10-08).

## Yêu cầu
- FR-UI-75-01 Trang "Tổng quan" (đầu thanh điều hướng): tên kênh + chế độ (Autopilot/Manual); lối tắt Video mới · Autopilot · Cài đặt kênh.
- FR-UI-75-02 Bốn ô số: Cần bạn · Đang làm · Xong (từ thẻ video 070) · Chờ đăng (074, bấm → trang Đăng).
- FR-UI-75-03 Khối YouTube: chưa kết nối → nút tới Cài đặt kênh; có báo cáo ngày (054) → lượt xem (± so hôm trước), phút xem, người đăng ký ròng, ngày số liệu, 3 video nổi bật; dòng "Ngày mai".
- FR-UI-75-04 Khối Cần bạn (5 video lỗi/chờ duyệt, bấm → mở video), Sắp đăng (4 mục), Render gần đây (4 bản, bấm → Thư viện).
- Chỉ dùng IPC có sẵn (`channels.managed`, `video.list`, `publish.queue`, `render.library`, `report.latest`, `publish.youtube.status`).

## AC
- UI test: 4 ô số; khối YouTube "Chưa kết nối".
