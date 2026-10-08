# 068 — Khung app: thanh điều hướng trái, các màn là trang

## Vấn đề
Khoảng 9 màn là hộp thoại chồng nhau (Cài đặt, Cài đặt kênh, Quản lý kênh, Autopilot, Lịch sử phiên…); sidebar dồn cả nút Cài đặt và Autopilot vào chung với danh sách video. Tan (2026-10-08) chọn: **thanh điều hướng trái + trang riêng**.

## Yêu cầu
- FR-UI-68-01 Thanh điều hướng trái (64 px): Video · Autopilot · Kênh ở trên, Cài đặt ở dưới; mục đang mở được đánh dấu (`aria-current="page"`).
- FR-UI-68-02 Trang `video` = sidebar + chat + tab như cũ; các trang khác (Cài đặt, Cài đặt kênh, Quản lý kênh, Autopilot hôm nay, Lịch sử phiên) chiếm toàn vùng chính (`role="region"`), nút Đóng về trang video.
- FR-UI-68-03 Cùng một màn vẫn dùng được như hộp thoại khi lồng trong màn khác (`Surface`/`AsPage`), ví dụ Cài đặt kênh mở từ Quản lý kênh.
- FR-UI-68-04 Hộp thoại nhỏ (xóa video, thùng rác, xuất video, xem file, chi tiết kênh) giữ dạng hộp thoại.

## AC
- UI test: Cài đặt mở như trang (danh sách video ẩn, hiện lại khi Đóng); Quản lý kênh là `region`; các `data-testid` cũ vẫn dùng được.
