# Research — 023

## R1. Producer storyboard là phiên mới mỗi vòng
- D5: phiên `producer` "một vòng", không lịch sử chat; tool như `main` ở phần artifact. Executor mở phiên qua `AgentRuntime.openSession(sessionOptionsFor("producer", …))` giống frame-build (011), gửi chỉ dẫn bước (+ vấn đề của vòng trước), chờ `workflow.step_complete {step_id}` qua `ctx.waitComplete`, đọc lại `STORYBOARD.md` làm bản nháp của vòng.
- `TextGenerateOutput` của vòng: `usage` 0 và `model: "agent:producer"` (phiên agent tính theo gói Claude, không qua `text.generate`); critic tính token/chi phí như 009.

## R2. Bước assets là engine + agent
- Ảnh sinh do nút `asset` (020) — chạy song song an toàn với lịch GPU (019). Chỉ giao agent khi còn layer cần ảnh thư viện/người dùng; explainer M1 thường không có → bước xong không cần phiên agent (khác M1: trước đây luôn hỏi agent).

## R3. Blueprint
- FN-023 gợi ý 4 blueprint mới; D13 chưa có gói blueprint nào trong app và frame agent (011) vẽ được bằng code theo `intent`. Hoãn tới khi có trường hợp thứ hai (nguyên tắc kiến trúc mục 16).
