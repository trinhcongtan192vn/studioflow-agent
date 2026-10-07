# 049 — Quyết định kỹ thuật

## R1. Gọi thẳng YouTube Data API, không qua MCP server (044)
MCP server `zubeid-youtube-mcp-server` không có tool uploads playlist / trending, và `channels_listVideos` của nó dùng `search.list` (100 đơn vị). Quét hằng ngày nhiều kênh × nhiều đối thủ cần rẻ quota → REST trực tiếp trong `src/youtube/data-api.ts` (mở rộng hàm `get()` của 047): uploads playlist + `playlistItems` + `videos.list` theo lô ≈ 5 đơn vị / đối thủ, trending 1 đơn vị. Hạn mức mặc định 10 000 đơn vị/ngày → dư cho hàng chục kênh. Đếm đơn vị trước mỗi lời gọi (Google tính cả lời gọi lỗi).

## R2. Parser RSS tự viết, không thêm phụ thuộc
Google Trends RSS và Google News RSS là RSS 2.0 phẳng (`<item>` + vài thẻ con, `ht:news_item` lồng một cấp). Regex + giải CDATA/thực thể đủ, có test fixture; thêm `fast-xml-parser` (≈ 100 KB) không đáng. Đầu vào hỏng → mảng rỗng, không ném lỗi (nguồn khác vẫn chạy).

## R3. Chấm điểm thuần, hằng số trong code (FN-049), không là khóa cấu hình
Chưa có số liệu thật để biết người dùng cần chỉnh gì; thêm khóa D3 sớm sẽ khóa hợp đồng. 057 (FR-AP-13) sẽ hiệu chỉnh từ hiệu quả thật — khi đó mới cân nhắc khóa. Tiếng Việt so theo âm tiết sau khi gập dấu (đơn giản, không cần bộ tách từ); từ dừng giữ ngắn để không mất từ chủ đề.

## R4. `research.scan` là job
Quét gọi mạng nhiều lần (vài giây) → theo D4 2.3 việc > 2 giây trả `job_id`. Engine riêng `research` để không chạy hai lần quét cùng lúc; `max_attempts: 1` vì lỗi nguồn đã được ghi trong file, thử lại cả job không có ích. Job idempotent (quét lại cùng ngày ghi đè).

## R5. Ngày của file theo `publish.timezone`
Lịch đăng (053) và kế hoạch ngày (051) dùng múi giờ này; dùng chung để "hôm nay" khớp nhau. Đường dẫn `research/<YYYY-MM-DD>.json` ở gốc kênh, có schema `ResearchDoc` (D3 5.17) → `WriteStore` kiểm schema khi ghi.

## R6. Video đã làm của kênh
Chỉ dữ liệu cục bộ (`publish.md` `title`, `BRIEF.md` `title_working`): kênh chưa có khóa ID kênh YouTube của chính mình (xem `[NEEDS CLARIFICATION]` trong spec). Số liệu thật của video đã đăng thuộc 054/057.
