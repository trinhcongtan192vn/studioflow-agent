# 043 — Cảnh báo thời lượng có thể bỏ qua

## Vấn đề
Bước Giọng đọc dừng hẳn khi audio thật lệch thời lượng mục tiêu quá ±10% (`objective(audio_duration)`), ví dụ 294 s so với 360 s. Video vẫn dùng được; người dùng cần quyền giữ nguyên.

## Yêu cầu
- FR-WF-43-01: `audio_duration` là kiểm **mềm**. Bước chỉ trượt kiểm mềm → `error.code = E_GATE_WARNING` (kiểm cứng trượt vẫn là `E_GATE_FAILED`).
- FR-WF-43-02: `workflow.waive {step_id, check}` (IPC + tool agent, D4) ghi `waived` vào `StepState` (D3) rồi kiểm tra lại trên file hiện có (như `workflow.recheck`, không sinh lại). Kiểm cứng không miễn được (`E_SCHEMA_INVALID`). Chạy lại bước → miễn trừ mất.
- FR-WF-43-03: Chat (thẻ lỗi/thông báo) và tab Tiến độ: cảnh báo thời lượng hiện "⚠ Cảnh báo", câu dễ hiểu (thời lượng thật/mục tiêu/từng beat), nút **Bỏ qua cảnh báo** (chính) và "Sửa cho đúng thời lượng" (nhờ agent sửa beat lệch).
- Skill: agent không tự bỏ qua khi người dùng chưa đồng ý.

## AC
- Integration `workflow-waive.test.ts`: cảnh báo → waive → bước xong, executor không chạy lại; kiểm cứng không waive được; rewind xoá `waived`.
- Unit desktop: `isDurationWarning`, `stepCtas`, `friendlyStepError`, `stepButtons`, `feedbackFor(waive)`.
