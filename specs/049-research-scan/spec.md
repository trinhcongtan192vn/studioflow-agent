# 049 — Quét nghiên cứu Autopilot (đối thủ, trending, tin nóng → chủ đề chấm điểm)

## Mục tiêu
FR-AP-04: mỗi ngày app quét đối thủ (video mới và video nổi bật cũ), video đã làm của kênh, chủ đề trending và tin nóng; chấm điểm chủ đề và ghi lý do. 049 làm dịch vụ quét + file kết quả + tool cho agent; lịch chạy hằng ngày và kế hoạch ngày là việc của 051/052.

## Yêu cầu
- FR-AP-04a (Data API): `src/youtube/data-api.ts` thêm playlist uploads (`channels.list part=contentDetails`), video mới (`playlistItems.list`), số liệu video theo lô ≤ 50 (`videos.list`), trending (`videos.list chart=mostPopular regionCode` theo ngôn ngữ kênh: vi→VN, de→DE, en→US). Không dùng `search.list`. Đếm đơn vị quota mỗi lần quét (D4 mục 9.5).
- FR-AP-04b (RSS, không khóa): Google Trends RSS theo vùng, Google News RSS search theo từng chủ đề trụ cột; parser RSS nhỏ tự viết (không thêm phụ thuộc).
- FR-AP-04c (chấm điểm): `src/research/score.ts` thuần — tỉ lệ vượt trội so với trung vị kênh đối thủ, tốc độ lượt xem/giờ, độ mới, khớp chủ đề trụ cột (gập dấu vi/de/en), độ mới so với video đã làm (Jaccard, gần trùng bị trừ). Điểm 0–100 + `reasons[]` tiếng Việt. Hằng số: FN-049.
- FR-AP-04d (artifact): `research/<YYYY-MM-DD>.json` ở gốc kênh (D3 mục 1, 5.17, schema `ResearchDoc`), ghi qua module ghi; ngày theo `publish.timezone`; quét lại trong ngày ghi đè; nguồn lỗi ghi vào `sources.*.error`, không làm hỏng cả lần quét.
- FR-AP-04e (tool/IPC): `research.scan` (job) và `research.get {date?}` — phiên `main` (D4 2.4, D5 4); IPC `research.latest {channel}` cho UI.

## AC
- `research-rss.test.ts`: parse RSS Google Trends (lượt tìm, tin kèm) và Google News (bỏ đuôi " - nguồn"), CDATA/thực thể, XML hỏng → mảng rỗng.
- `research-score.test.ts`: tỉ lệ vượt trội, tuổi video < 7 ngày, tốc độ, khớp chủ đề có/không dấu (vi/de), gần trùng bị trừ điểm, điểm trong 0–100, có lý do.
- `research-data-api.test.ts`: đúng endpoint/tham số, lô 50 ID, phân trang, đếm quota; thiếu khóa / HTTP lỗi / kênh không có → mã lỗi chuẩn.
- `research-scan.test.ts` (integration, fetch giả): hai đối thủ + trending + trends + tin trên kênh mẫu → `research/<ngày>.json` hợp lệ schema, có ứng viên evergreen và gần trùng; quét lại ghi đè (một file); RSS lỗi được ghi, quét vẫn xong; không khóa → chỉ RSS; tool `research.scan`/`research.get` qua Gateway; IPC `research.latest`.
- `gateway-policy.test.ts`: `research.scan`, `research.get` chỉ `main`.

## Làm rõ
- [NEEDS CLARIFICATION: "video đã làm của kênh" — kênh chưa có khóa ID kênh YouTube của chính mình, nên 049 chỉ lấy tiêu đề từ `videos/*/publish.md` / `BRIEF.md`. Số liệu thật của video đã đăng (FR-AP-13) để 054/057.] Mặc định an toàn: chỉ đọc dữ liệu cục bộ.
- [NEEDS CLARIFICATION: có loại Shorts (≤ 60 giây) của đối thủ khỏi ứng viên cho kênh video dài không?] Mặc định: không lọc, ghi `metrics.duration_s` để bước kế hoạch (051) tự chọn.
- Ngày của file theo `publish.timezone` (mặc định Asia/Ho_Chi_Minh) — cùng múi giờ với lịch đăng.
