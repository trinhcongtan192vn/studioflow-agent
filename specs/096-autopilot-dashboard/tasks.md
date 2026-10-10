# Tasks 096

- [x] Cập nhật D10 và spec/plan.
- [x] Test fail trước: preview không ghi và vượt pause, chặn lập thật rỗng, theo dõi job.
- [x] Core preview + job.get + kiểm đầu vào lập kế hoạch; CLI preview.
- [x] UI kế hoạch/thử/bật tắt + gộp duyệt đăng.
- [x] Tắt kênh giữa lượt chạy: dừng ở ranh giới bước, giữ video dở; kênh khác chạy tiếp.
- [x] Hồi quy core, UI, typecheck/build/lint.

Nghiệm thu 10/10/2026: 146 core tests liên quan (plan/host/publish queue/runner); 102 desktop unit tests (gồm 097); Electron 096/097 đều qua. Kiểm CLI thật trên kênh mẫu: trả một kế hoạch trong khi paused, không lưu kế hoạch sản xuất. Contracts và structure qua; lint không lỗi, Workspace còn 2 cảnh báo hook có sẵn. Không sản xuất/đăng lên tài khoản thật.
# Bổ sung: bỏ ràng buộc năng lực khi lập kế hoạch (10/10/2026)

- [x] Bỏ giới hạn số mục theo năng lực ước tính trong cả xem thử và lập kế hoạch; giữ số lượng mỗi ngày do kênh cấu hình.
- [x] Kiểm thử tái hiện lỗi trước khi sửa cho cả ba yếu tố token, thời gian và upload; xác nhận lập lại kế hoạch rỗng cũ và xem thử không ghi dữ liệu.
- [x] 61 kiểm thử planner và 69 kiểm thử runner đạt; core typecheck và kiểm tra contracts đạt.

## CTA từng mục và transcript (AC-05/05b)

- [x] Cập nhật D10/spec/plan; test fail trước cho hành động và nguồn kịch bản.
- [x] Core xóa/chuyển thủ công, IPC/CLI, chống tạo trùng và sửa mục có video.
- [x] CTA ở kế hoạch/xem thử, mở workspace video, ngôn ngữ mặc định kênh.
- [x] 158 kiểm thử core liên quan (plan/host/text/runner) và kiểm thử Electron CTA đạt; typecheck/contracts/structure/lint/build đạt. Chỉ dùng LLM giả/replay.


- [x] AC-05b amendment: pass source URL to brief/chat and reuse existing agent MCP tools; remove the separate transcript file/prompt pipeline.
