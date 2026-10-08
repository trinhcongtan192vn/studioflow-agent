# 071 — Trang Cài đặt chia mục; kết nối Telegram và tài khoản đăng video

## Vấn đề
Cài đặt là một khối dài trộn khóa API (tên thô `youtube_oauth_client_id`…), model gõ tay, Autopilot, Trace, Dung lượng; 053–057 đã có API kết nối YouTube/TikTok/Facebook và bot Telegram nhưng không có màn nào (Tan, 2026-10-08).

## Yêu cầu
- FR-UI-71-01 Trang Cài đặt: mục lục trái (Giao diện · Kết nối · Khóa API · Model AI · Autopilot · Lưu trữ · Nâng cao · Giới thiệu), mỗi mục một khối; bấm mục lục → cuộn tới.
- FR-UI-71-02 Khóa API nhóm theo việc dùng (AI viết, Ảnh, YouTube, Khác), tên dễ đọc, chỉ hiện 4 ký tự cuối; token Telegram ở mục Kết nối.
- FR-UI-71-03 Telegram: trạng thái bot (@tên), bot token (`telegram.set_token`), chat ID nhóm, người được ra lệnh, bật/tắt (`telegram.*`), gửi tin thử.
- FR-UI-71-04 Cài đặt kênh → Đăng video: YouTube (trạng thái, kênh đã nối, hạn mức, cảnh báo chưa kiểm duyệt; "Kết nối YouTube" mở trang đăng nhập Google trong trình duyệt và chờ kết nối; Ngắt kết nối), TikTok/Facebook (token, Page ID, ngắt).
- FR-UI-71-05 Model AI có gợi ý; Giới thiệu: phiên bản, đăng nhập Claude, thành phần thiếu, thư mục dữ liệu app (`app.status.app_data_dir`, mở được).
- Mở URL ngoài chỉ nhận `https://` (`shell:external`).

## AC
- UI test: mục lục "Kết nối" → khối Telegram; Cài đặt kênh có `channel-connections` với nút Kết nối YouTube.
