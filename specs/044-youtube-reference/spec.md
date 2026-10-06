# 044 — Tạo video từ video YouTube tham khảo (qua MCP server YouTube)

## Mục tiêu
Người dùng gửi URL YouTube trong chat ("làm video giống/hay hơn video này"). Agent đọc video, phân tích **công thức** tạo nội dung hấp dẫn (không chép nội dung), chọn angle tốt nhất rồi đưa vào luồng workflow bình thường (brief → duyệt → các bước sau). Hạ tầng bọc qua MCP để mở rộng: nghiên cứu video hot, kênh đối thủ.

## Quyết định (Tan, 2026-10-06)
- Khóa YouTube Data API v3 nhập trong Cài đặt → Credential Manager (`StudioFlow/youtube_api_key`).
- Core chạy MCP server `zubeid-youtube-mcp-server` (MIT, ghim 1.0.2) qua stdio, cài riêng trong `<app-data>/mcp/youtube` lúc dùng lần đầu; bọc thành tool Gateway `youtube.*` (quyền D5, log, lỗi chuẩn).
- Luồng: lưu `REFERENCE.md` + tóm tắt trong chat → brief từ best angle → thẻ duyệt brief.

## Yêu cầu
- FR-YT-01: Tool `youtube.video`, `youtube.transcript`, `youtube.search`, `youtube.channel_videos` (D4 mục 2.4, 9.4); chỉ phiên `main` (D5 mục 4).
- FR-YT-02: Nhận mọi dạng URL (watch, youtu.be, shorts, embed, live, m.) hoặc ID 11 ký tự; URL khác → `E_SCHEMA_INVALID`; video không có → `E_FILE_NOT_FOUND`.
- FR-YT-03: Kết quả rút gọn cho agent: metadata chính, mô tả ≤ 2000 ký tự; transcript gộp mốc ~20 giây `[m:ss]`, ≤ 60k ký tự; thử ngôn ngữ yêu cầu → vi → en → ngôn ngữ YouTube báo có sẵn.
- FR-YT-04: Thiếu khóa → `E_PROVIDER_UNAVAILABLE` hướng dẫn thêm trong Cài đặt; server lỗi → `E_PROVIDER_FAILED`. Đổi khóa → khởi động lại server.
- FR-YT-05: Skill `studioflow` mục "Tạo video từ video YouTube tham khảo": mẫu phân tích (Core idea, Audience & promise, Hook, Structure, Retention drivers, Winning formula, 3 Adaptation, Best angle), tập trung "why it works / how to reproduce", ghi `REFERENCE.md`, brief có mục "Công thức tham khảo".

## AC
- Unit/integration `youtube-tools.test.ts` với MCP server giả (stdio, cùng tên tool).
- Policy test: `youtube.*` chỉ `main`.
- Thử thật (khóa của Tan): `youtube.video`, `youtube.search`, `youtube.transcript` trên video có phụ đề.
