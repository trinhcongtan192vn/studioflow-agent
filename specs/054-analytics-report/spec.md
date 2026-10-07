# 054 — Số liệu YouTube và báo cáo ngày

## Mục tiêu
FR-AP-11 (PRD 8.13): thu số liệu hiệu quả từ YouTube Analytics API + Data API vào SQLite, mỗi ngày gửi một báo cáo tiếng Việt cho từng kênh quản lý vào nhóm Telegram; người dùng gõ `/report` để xem ngay. Số liệu này cũng là đầu vào của vòng phản hồi 057.

## Yêu cầu
- FR-AP-11a (thu số liệu, D4 9.7): dùng token OAuth của kênh (053, phạm vi `yt-analytics.readonly`, `youtube.readonly`). Cửa sổ 7 ngày gần nhất mỗi lần (YouTube trễ và chỉnh lại số liệu), ngày theo múi giờ Thái Bình Dương. Ba bảng trong `studioflow.db`: số liệu kênh theo ngày (`channel_metrics`), từng video do app đăng theo ngày (`video_metrics`), ảnh chụp lũy kế (`video_stats`, Data API `videos.list part=statistics`, lô ≤ 50, 1 đơn vị quota). Ghi đè theo khóa → thu lại là idempotent.
- FR-AP-11b (độ tươi, lỗi): thu tối đa mỗi 6 giờ mỗi kênh (cũng thu trước khi soạn báo cáo nếu cũ hơn 6 giờ); kênh chưa kết nối OAuth → bỏ qua và báo cáo ghi chú; một video lỗi (mới đăng, 403) không làm hỏng cả lần thu; lỗi nguồn không ném ra ngoài, báo cáo vẫn được soạn kèm ghi chú.
- FR-AP-11c (báo cáo, D3 5.20 `DailyReport`): đối tượng có cấu trúc gồm lượt xem so với hôm trước và trung bình 7 ngày (%), giờ xem, người đăng ký, video nổi bật 7 ngày (tên theo kế hoạch), sản xuất hôm nay (xong / cần xem / hỏng / đang làm / chờ), đăng bài (đã tải / chờ), Claude đã dùng so với ngân sách ngày, quota YouTube, dòng "Ngày mai", ghi chú. Hàm thuần `composeReport` + `formatReportHtml` (tin Telegram HTML, thoát ký tự).
- FR-AP-11d (lịch): khóa app `report.time` (mặc định `21:00`, giờ theo `publish.timezone` của từng kênh) và `report.enabled` (mặc định true). `AutopilotRunner.tick` gọi `ReportService.process` mỗi lượt, kể cả khi tạm dừng hoặc ngoài khung giờ (chỉ đọc số liệu và gửi tin). Mỗi kênh một báo cáo mỗi ngày: file `autopilot/reports/<ngày>.json` (qua WriteStore), `delivered_at` là dấu đã gửi → idempotent và chịu khởi động lại; gửi không được (Telegram tắt/lỗi) thì file ở lại chưa `delivered_at` và lượt sau chỉ thử gửi lại.
- FR-AP-11e (theo yêu cầu): lệnh Telegram `/report`, IPC `report.latest {channel?}` và `report.run {channel?, send?}` (D10), tool Gateway `report.get {date?, channel?}` cho phiên `main` và `ops` (D4 2.4). Soạn theo yêu cầu không ghi file và không đánh dấu đã gửi.
- Cài đặt: `settings.set` kiểm `report.time` (HH:MM) và `report.enabled` (boolean) với `E_SCHEMA_INVALID`.

## AC
- `tests/unit/report-compose.test.ts` (so sánh %, video nổi bật, ghi chú, định dạng tin, kiểm giá trị cài đặt).
- `tests/integration/analytics-report.test.ts` (thu số liệu, idempotent/độ tươi/force, video lỗi, chưa kết nối, lịch một lần mỗi ngày, trước giờ, khi tạm dừng, khởi động lại, Telegram tắt rồi bật, tắt báo cáo, múi giờ, Google sập, `/report`, IPC, tool).
- `tests/contract/gateway-policy.test.ts` (`report.get` main + ops).

## Làm rõ
- [NEEDS CLARIFICATION: CTR / impressions — YouTube Analytics API không trả impressions cho kênh thường; cần YouTube Reporting API (báo cáo hàng loạt tạo job rồi tải CSV sau ~48 giờ).] Chưa làm; báo cáo không có CTR. Làm sau nếu cần.
- [NEEDS CLARIFICATION: báo cáo gộp một tin cho nhiều kênh hay một tin mỗi kênh.] Đã cài: một tin mỗi kênh (gọn, dễ chuyển tiếp).
- [NEEDS CLARIFICATION: ngân sách Claude khi chưa biết `autopilot.daily_tokens`.] Đã cài: hiển thị "chưa biết ngân sách ngày", `used_pct` null.
- Chỉ video do app đăng (có `video_id` trong kế hoạch 30 ngày) được thu theo ngày; video tải lên tay không được thống kê riêng (vẫn nằm trong số liệu cả kênh).
