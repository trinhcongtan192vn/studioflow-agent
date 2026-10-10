# 096 — Trang quản lý Autopilot chung

Dựa trên D10 mục 2 (096), D3 5.18, D4 job, 051/052/074. Yêu cầu trực tiếp của Tan ngày 09/10/2026.

- FR-AP-96-01 / AC-01: chưa bật kênh hoặc toàn cục tạm dừng → không xếp job lập lại; giải thích rõ. Job có tiến trình và kết quả cuối (số mục, rỗng, lỗi), không treo thông báo đang lập; chặn bấm lặp khi đang chờ.
- FR-AP-96-02 / AC-02: mỗi kênh có Xem thử kế hoạch kể cả khi tắt; giữ nguyên trạng thái kênh và các file kế hoạch, hiển thị chủ đề/workflow/giờ đăng/lý do/giới hạn. Không tạo video hoặc đăng; có thể quét nghiên cứu khi chưa có. Tạm dừng toàn cục không chặn xem thử. Kế hoạch thật được tính lại khi chạy.
- FR-AP-96-03 / AC-03: danh sách đầy đủ kênh quản lý, công tắc Autopilot từng kênh, mở cài đặt kênh để đặt nguồn nghiên cứu/lịch đăng. Kênh mất thư mục hiện lý do và không thao tác.
- AC-03b: tắt giữa lượt chạy → hoàn tất bước hiện tại, giữ video dở, không bắt đầu bước/video tiếp theo của kênh; kênh khác chạy tiếp. Bật lại tiếp tục cùng video.
- FR-AP-96-04 / AC-04: gộp duyệt đăng trong Autopilot, có bộ lọc kênh; giữ xem video, trạng thái nền tảng, đăng ngay/hủy đăng. Kênh đã tắt vẫn có hàng đợi. Bỏ sidebar Đăng, chuyển lối tắt Tổng quan sang tab duyệt đăng.

Không tự bật kênh của người dùng trong quá trình phát triển. Preview dùng dữ liệu hiện tại, không tạo chủ đề mẫu giả nếu nghiên cứu rỗng.

- AC-05b: chuyển URL nguồn sang brief/chat; agent dùng MCP lấy thông tin video/transcript theo luồng hiện có. Không thêm pipeline transcript riêng cho CTA (Tan xác nhận 10/10/2026).

- FR-AP-96-05 / AC-05: từng mục chưa chạy có Xóa/Tạo video; hỗ trợ bản xem thử và kênh tắt hoặc toàn cục tạm dừng. Xóa đánh dấu bỏ qua, ẩn khỏi UI và chống thêm lại chủ đề khi lập lại. Mục có video hoặc đang/đã chạy không được xóa/tạo thêm. Tạo thủ công chuyển riêng mục đã chọn khỏi hàng đợi Autopilot, khởi động chat và mở video; giữ workflow/dạng xuất/chủ đề/góc nhìn/nguồn và các điểm duyệt thủ công. Ngôn ngữ lấy từ channel.language hiện tại. Bấm lại không tạo trùng. Lỗi phải hiển thị và video đã tạo vẫn mở được.

Cập nhật theo yêu cầu Tan 10/10/2026: bỏ phần trình bày năng lực/giới hạn (toàn cục và từng kênh) cùng lời gọi capacity riêng ở UI. Bản xem thử chỉ hiện ngày, nội dung, lịch đăng và lý do chọn/không có mục. Thay thế yêu cầu hiển thị giới hạn trong AC-02; không thay đổi thuật toán lập kế hoạch.

Amendment 2026-10-10: preview and persisted plans must ignore estimated token, time and upload capacity. Only the configured channel max_per_day bounds item count. Preserve existing items and topic/score filters. Replanning an old capacity-blocked empty plan must populate items and replace stale notes. Capacity snapshots remain informational; runtime safeguards remain in force.
