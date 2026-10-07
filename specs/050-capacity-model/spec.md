# 050 — Mô hình năng lực Autopilot: hôm nay làm được bao nhiêu video

## Mục tiêu
FR-AP-05 (PRD 8.13): app ước tính số video làm được trong ngày từ thời gian thật của từng bước trên máy này, ngân sách Claude và hạn mức đăng. Kết quả là đầu vào của bộ lập kế hoạch ngày (051). Chi tiết thuật toán: FN-050 (`docs/feature-notes/050-capacity.md`); quyết định: `research.md`.

## Quyết định (Tan, 2026-10-07)
- Khung giờ máy làm việc đặt trong Cài đặt (`autopilot.work_window`, mặc định `08:00-23:00`, được qua đêm như `22:00-06:00`).
- Autopilot dùng `autopilot.budget_share` (mặc định 0,7) ngân sách Claude ngày; phần còn lại để làm tay qua chat.
- Trần mỗi kênh `autopilot.max_per_day`; hạn mức YouTube ≈ 6 lượt đăng/ngày mỗi dự án Google (10 000 đơn vị, ~1 600 mỗi lượt).

## Yêu cầu
- FR-AP-05-a — Thời gian mỗi video theo workflow: từ span `sf.workflow.step` đã xong, mỗi bước lấy trung vị thời lượng span trên K = 5 video gần nhất, cộng lại; kèm số mẫu (độ tin cậy). Chỉ đo thời lượng span bước (không đo khoảng giữa hai bước) → thời gian chờ duyệt không làm phình ước tính. Bỏ span lỗi và span gate trượt (`sf.step_outcome = failed`, thuộc tính mới của span bước, D11). Chưa có lịch sử → mặc định theo workflow (FN-050), đánh dấu độ tin cậy thấp.
- FR-AP-05-b — Token Claude: token mỗi video theo workflow từ bảng `usage` (Claude); ngân sách ngày = `autopilot.daily_tokens` (khóa mới tầng app, D3 7.2, mặc định null) hoặc học từ lần chạm hạn mức gần nhất (tổng 7 ngày trước đó ÷ 7); token còn = ngân sách × `autopilot.budget_share` − token đã dùng từ đầu ngày làm việc − token còn cần của video đang dở. Chưa chạm hạn mức và chưa đặt khóa → chưa biết, không giới hạn theo token, ghi lý do.
- FR-AP-05-c — Thời gian còn hôm nay trong khung giờ theo `publish.timezone` tầng app (cả khung qua đêm); nhân biên an toàn 0,8; trừ việc còn lại của video đang có bước chạy.
- FR-AP-05-d — Kết quả `capacityToday` (`packages/core/src/autopilot/capacity.ts`): `videos`, `by_workflow[] {workflow_id, est_ms, tokens, samples, low_confidence}`, `window_ms_left`, `time_budget_ms`, `tokens_left`, `daily_tokens(+_source)`, `upload_quota_left`, `limiting_factor: time|tokens|uploads|cap`, `channels[]` (số video khả thi từng kênh, trần còn, yếu tố giới hạn), `reasons[]` (tiếng Việt). Đầu vào nhận danh sách kênh (workflow được phép, trần, nền tảng) để 051 gọi trực tiếp.
- FR-AP-05-e — IPC `autopilot.capacity` (D10 mục 4): mặc định cho các kênh quản lý đang bật Autopilot; `channels` để xem trước kênh chưa bật.
- `settings.set` kiểm `autopilot.daily_tokens`: số nguyên dương hoặc null (học tự động).

## Ngoài phạm vi
- Giao diện hiển thị năng lực (051 dùng trong màn kế hoạch ngày).
- Đếm video Autopilot đã tạo hôm nay và đơn vị YouTube đã dùng: nguồn ghi có ở 052/053 (xem dưới).

## Chưa rõ
- [NEEDS CLARIFICATION: video nào tính vào "đã làm hôm nay" cho trần `autopilot.max_per_day` — chỉ video Autopilot tạo (052 đánh dấu) hay cả video làm tay của kênh?] Mặc định an toàn hiện tại: IPC truyền `done_today = 0` (chưa có dấu Autopilot); 051/052 truyền số thật.
- [NEEDS CLARIFICATION: đơn vị YouTube Data API đã dùng hôm nay ghi ở đâu (quét đối thủ 049, đăng 053)?] Hiện tham số `youtube_units_used_today` (mặc định 0); các tính năng sau ghi và truyền vào.
- [NEEDS CLARIFICATION: hạn mức dự án Google có thể được Google nâng — có cần khóa cấu hình riêng?] Hiện hằng số 10 000 / 1 600 (FN-050); thêm khóa khi có người dùng cần.

## AC
- `tests/unit/autopilot-capacity.test.ts`: trung vị, bỏ span lỗi / gate trượt, thời gian chờ duyệt không tính, mặc định khi chưa có lịch sử, khung giờ qua đêm và múi giờ, học ngân sách từ lần chạm hạn mức, chọn yếu tố giới hạn (time / tokens / uploads / cap), trần từng kênh và chia vòng tròn, việc còn lại của video dở.
- `tests/integration/autopilot-capacity.test.ts`: DB tạm (`openDb`) với dòng `spans` + `usage` → đọc DB + `capacityToday`; engine ghi `sf.step_outcome` lên span bước.
- `tests/integration/host.test.ts`: IPC `autopilot.capacity` cho kênh bật Autopilot, ghi đè `autopilot.daily_tokens`, giá trị sai bị từ chối.
