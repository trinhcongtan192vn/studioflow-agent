# Dùng thử Autopilot

1. Mở Autopilot trên sidebar → Kế hoạch & kênh.
2. Ở kênh cần thử, mở Cài đặt kênh để đặt nội dung/trụ cột, nguồn đối thủ, workflow, số video tối đa và khung giờ đăng. Thiết lập khung giờ làm việc/ngân sách toàn cục trong Cài đặt app nếu năng lực bằng 0.
3. Bấm Xem thử kế hoạch. Không cần bật kênh hoặc bỏ tạm dừng. Đọc chủ đề, workflow, ngày/giờ đăng, Vì sao chọn và lý do không có mục. Bản xem thử tính năng lực riêng cho kênh; không vào hàng đợi sản xuất.
4. Muốn chạy thật, bật Autopilot ngay ở kênh. Nếu toàn cục tạm dừng, bấm Tiếp tục. Các lượt tự động sẽ tính kế hoạch thật theo toàn bộ kênh bật và khung giờ làm việc; Chạy ngay bỏ qua khung giờ làm việc. Lập lại kế hoạch chỉ bổ sung chỗ trống, giữ mục đã có.
5. Duyệt trước khi đăng nằm trong tab thứ hai, có lọc theo kênh. Tắt kênh vẫn xem/đăng ngay/hủy được nội dung của kênh đó. Lịch đã gửi lên nền tảng cần Hủy đăng riêng.

CLI: `node packages/core/bin/sf.mjs autopilot preview --channel "<thư mục kênh>"`.
