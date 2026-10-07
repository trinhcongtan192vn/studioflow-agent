# 054 — Ghi chú nghiên cứu

- **Analytics API**: `GET youtubeanalytics.googleapis.com/v2/reports?ids=channel==MINE&dimensions=day&metrics=…&sort=day`; lọc video `filters=video==<id>`. Quota riêng, không tính vào 10 000 đơn vị của Data API. Số liệu trễ 1–3 ngày và được chỉnh lại → luôn thu lại 7 ngày gần nhất và ghi đè.
- **Múi giờ**: Analytics tính ngày theo giờ Thái Bình Dương; báo cáo dùng múi giờ kênh cho "hôm nay" nhưng ngày số liệu hiển thị là ngày YouTube trả về (có ghi chú khi cũ quá 3 ngày).
- **Quota**: chỉ `videos.list` (1 đơn vị/lô) tính vào sổ quota của 053.
- **Báo cáo lệch gợi ý**: `docs/feature-notes/` không có ghi chú riêng; cấu trúc `DailyReport` theo yêu cầu của chủ dự án. Soạn bằng hàm thuần để test snapshot dễ.
- **Không dùng LLM** để soạn báo cáo: tiết kiệm token và xác định được (cùng số liệu → cùng tin). Agent `ops` vẫn có thể hỏi `report.get` để diễn giải.
- **Idempotence**: dấu đã gửi nằm trong file báo cáo (bền qua khởi động lại), không dùng trạng thái bộ nhớ.
