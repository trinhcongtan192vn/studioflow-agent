# 083 — Bước chờ người dùng trả lời; Telegram cập nhật trạng thái; đủ ba vai model

## Bối cảnh
- vd_rbxtpyp5: bước `voice` giao agent gợi ý giọng; agent tạo 3 giọng rồi dừng lượt chờ người dùng chọn
  (đúng chỉ dẫn) nhưng engine coi đó là lỗi `agent stopped without completing step voice`. Lượt sau agent gọi
  `workflow.step_complete` thì bị từ chối (`step voice is not waiting for an agent`).
- Cài đặt → Telegram: sau khi lưu token, trạng thái chỉ đọc một lần (bot chưa kịp kết nối) → kẹt "Đang dừng";
  "Gửi tin thử" bị khóa theo trạng thái đó.
- Cài đặt → Model AI chỉ có model viết; thiếu model chấm và model phụ (`text.critic`, `text.aux`).

## Yêu cầu
- FR-WF-83-01: agent dừng lượt mà chưa báo xong bước → bước `failed` với `E_STEP_INCOMPLETE`, thông điệp kết thúc
  `waiting for your reply in chat`. Chat hiện "💬 Bước … đang chờ bạn trả lời", không phải "✕ Lỗi".
- FR-WF-83-02: ở lượt sau, `workflow.step_complete` cho bước đang chờ được nhận; khi lượt chat của video kết
  thúc (`resumeAfterTurn`), bước chạy lại và lần giao agent đầu tiên của bước được coi là đã xong (dùng outputs
  agent báo). Bước voice đã đủ giọng thì dựng audio tiếp.
- FR-UI-83-03: host phát sự kiện `telegram.updated` khi trạng thái bot đổi; Cài đặt cập nhật nhãn (Đang kết nối… /
  Đang chạy / Lỗi kết nối / Đang tắt / Chưa có token); "Gửi tin thử" chỉ cần token + chat ID.
- FR-UI-83-04: Cài đặt → Model AI có ba ô: Model viết, Model chấm (phải khác model viết), Model phụ.
- Test CLI dùng thư mục dữ liệu app riêng (`SF_APP_DATA`), không đọc cấu hình thật của máy.
