# 085 — Chế độ gọn: tính năng nâng cao tắt mặc định, model rẻ, tiêu đề từ SRT

## Bối cảnh
Tan chưa chạy trọn được video nào mà đã tốn token. Số liệu thật (Short vd_rbxtpyp5, 45 giây): kịch bản refine
3 vòng (Sonnet viết, Opus chấm, ~12,7k token ra); bước nhạc là một phiên agent dù kho nhạc trống; tiêu đề/mô tả
refine thêm một vòng, đọc lại brief + kịch bản. Triết lý mới: mặc định rẻ và ít bước; thứ tốn kém là tính năng
nâng cao, bật ở kênh hoặc từng video.

## Yêu cầu
- FR-WF-85-01: khóa `advanced.refine`, `advanced.music`, `advanced.reasoning` (boolean, tầng app, channel,
  video; mặc định `false`). Video ghi đè kênh, kênh ghi đè app. Workflow (`config_defaults`) không đặt các khóa
  này (D3 7.1 — tầng workflow đứng sau kênh nên sẽ đè lựa chọn của người dùng).
- FR-WF-85-02: refine chỉ chạy khi manifest bật `refine` **và** `advanced.refine` = true. Tắt → một bản nháp,
  kiểm khách quan trên máy (schema, beat, từ cấm…); có kiểm trượt → một lần sửa bằng producer với danh sách lỗi
  đó (không gọi critic). Bật → `refine.min_rounds` mặc định 1, `refine.max_rounds` mặc định 2 (dừng sớm khi đạt
  ngưỡng). Cổng chất lượng Autopilot coi bước là "không có refine" khi `advanced.refine` tắt.
- FR-WF-85-03: bước `music` có `skip_if: { config: advanced.music, equals: false }` trong mọi workflow; bật →
  engine tự chọn nhạc (executor, không phiên agent, 0 token): mỗi scene có `music.query` (hoặc `mood`) gọi
  `music.find` (CLAP khi có, không thì từ khóa) với `min_duration_ms` ≈ thời lượng audio; không thấy → thử lại
  không lọc thời lượng; vẫn không → `music: none`. Scene đã có `track_id` hoặc `none` giữ nguyên.
- FR-TX-85-04: model mặc định (khi `text.*` chưa đặt):
  - `advanced.reasoning` tắt: producer = `deepseek/deepseek-chat` nếu có khóa DeepSeek, không thì
    `claude/claude-sonnet-5-5`; critic = `claude/claude-sonnet-5-5` (producer là Sonnet → `claude-haiku-4-5`);
    aux = `deepseek/deepseek-chat` nếu có khóa, không thì `claude/claude-haiku-4-5`.
  - bật: producer = `claude/claude-opus-5-5`; critic = `claude/claude-sonnet-5-5`; aux như trên.
  - `text.*` đặt tường minh (Cài đặt → Model) luôn thắng.
- FR-TX-85-05: bước `publish-meta` chỉ đọc phụ đề SRT (từ `caption_groups.json` + `caption-overrides.json`; chưa
  có → lời đọc trong `SCRIPT.md`) và thông tin kênh (tên, ngôn ngữ, chủ đề trụ cột, `style-guide.md`); không đọc
  brief/storyboard. Dùng model aux, một lần gọi (refine theo FR-WF-85-02). Chương lấy từ mốc beat như cũ.
- FR-UI-85-06: khối "Nâng cao" ở Cài đặt kênh (mục mới) và tab Tiến độ của video: mỗi khóa một công tắc kèm mô
  tả chi phí; ở video có lựa chọn "Theo kênh (Bật/Tắt)". IPC `advanced.get` / `advanced.set` (giá trị `null` =
  bỏ ghi đè ở tầng đó). Cài đặt → Model ghi rõ ô trống = tự chọn theo chế độ reasoning.

## Ngoài phạm vi
Frame dựng từ mẫu và tạm dừng khi hết lượt (086); chạy nháp và ước lượng token (087).
