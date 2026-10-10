# Kế hoạch 096

Tái dùng planToday với chế độ preview bỏ ghi kế hoạch và bỏ gate paused; job trả DailyPlan qua JobInfo.result. IPC job.get để theo dõi chính xác, polling khôi phục khi lỡ event. Kiểm đầu vào lập thật rỗng/paused trong enqueuePlanRun. Gateway giữ nguyên đường ghi nghiên cứu/học/cấu hình.

AutopilotPanel thêm tab Kế hoạch / Duyệt đăng, danh sách kênh đầy đủ, xem thử theo kênh, bật/tắt và cài đặt. PublishReview hỗ trợ nhúng, tái sử dụng thao tác đăng, không tạo Surface lồng trang. Lối tắt publish chuyển tab.

Gate I–X: đạt; yêu cầu đã được người dùng chỉ định, không còn mâu thuẫn. Logic chọn kế hoạch vẫn ở core; CLI `sf autopilot preview --channel <dir>`. Không đổi schema artifact, không migration. Job giữ span hiện hữu. Test tích hợp FS thật + UI Electron, không gọi LLM/GPU. Không thêm adapter/project.

AC-05/05b: module core plan-actions chuyển riêng mục sang skipped và dự trữ video_id trước lượt chat; createVideo lấy channel.language. Xóa giữ tombstone trong note để chống trùng, không cho khôi phục bằng plan.update. IPC trả ngay video_id rồi host giao chat, lỗi ghi vào chat. CLI remove-item/create-video cung cấp thao tác core và chỉ dẫn. Không thay schema artifact. Bản xem thử chỉ nhập mục được bấm tạo; xóa preview cục bộ. Chỉ dẫn YouTube lấy transcript/metadata và lưu TRANSCRIPT.md/REFERENCE.md; scriptExecutor thêm hai file vào prompt và provenance cho cả tạo/sửa. Không gọi dịch vụ thật khi kiểm thử. URL is passed to the agent, which uses existing MCP tools for metadata and transcripts. No separate transcript pipeline.
