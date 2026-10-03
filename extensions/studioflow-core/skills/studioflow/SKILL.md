---
name: studioflow
description: Quy tắc làm việc với dự án video StudioFlow — artifact, ID, đường dẫn và công cụ sf. Dùng khi đọc/ghi SCRIPT.md, STORYBOARD.md, BRIEF.md hoặc chạy lệnh trong video.
---

# StudioFlow — quy tắc miền

- Mỗi kênh là một thư mục; mỗi video là `videos/<vd_…>/`. Đường dẫn trong công cụ `sf` là **tương đối thư mục video** (ví dụ `SCRIPT.md`, `audio/lines/ln_….wav`).
- Đọc bằng `mcp__sf__artifact_read`, ghi bằng `mcp__sf__artifact_write` (gửi toàn bộ nội dung file). Muốn chắc file không bị đổi giữa chừng, truyền `base_hash` lấy từ lần đọc.
- `SCRIPT.md`: mỗi beat là heading `##` có marker `<!-- sf:beat id=bt_… -->`; mỗi line là marker `<!-- sf:line id=ln_… speaker=… -->` + đoạn văn ngay sau. Line/beat mới **không cần ID** — Gateway gán khi ghi. Giữ nguyên ID khi sửa chữ.
- `STORYBOARD.md`: khối ```` ```sf-scene ```` và ```` ```sf-frame ```` (YAML). Mỗi line thuộc đúng một frame.
- Không sửa `.sf/` (dữ liệu dẫn xuất). Không xóa file — không có công cụ xóa.
- Kiểm tra trước khi ghi bằng `mcp__sf__artifact_validate {path, content}`; lỗi có đường dẫn trường.
- Giá trị cấu hình (look, giọng, caption…) lấy bằng `mcp__sf__config_resolve`, không đoán.
