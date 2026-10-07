# 060 — Giảm token Claude ở bước Dựng frame

## Vấn đề
Dựng frame là bước tốn token Claude nhất (mỗi frame một phiên agent); hạn mức tuần đã hết giữa chừng khi làm "Cậu bé và con trâu".

## Yêu cầu
- FR-CP-60-01: Chọn model theo độ phức tạp frame: frame đơn giản (≤ 3 layer, ≤ 10 s, không khẩu hình, không bản đồ/biểu đồ/sơ đồ/dòng thời gian/so sánh, không chỉnh tay ghim) dùng `frame_build.model_simple` (mặc định `claude-haiku-4-5-20251001`) ở lần đầu; frame phức tạp và **lần thử lại** dùng `frame_build.model` (mặc định `claude-sonnet-5-5`). `frame_build.model_simple` rỗng = tắt.
- Khóa D3 7.2 `frame_build.model`, `frame_build.model_simple` (app, channel).

## Ngoài phạm vi (để sau)
- Gộp nhiều frame ngắn vào một phiên; điền template blueprint không cần LLM cho bố cục lặp (tiêu đề, danh sách) — cần đo chất lượng trên kênh thật trước.

## AC
- `frame-model.test.ts`: phân loại, chọn model, thử lại leo model chính, tắt model rẻ.
- `frame-build.test.ts`: frame đơn giản dùng Haiku, lần thử lại dùng Sonnet.
- `frame-live` ghi lại với Claude thật: frame do Haiku dựng qua lint + check; một lần Haiku hỏng được Sonnet dựng lại.
