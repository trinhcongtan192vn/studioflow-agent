# 057 — Vòng phản hồi: học từ hiệu quả thật

## Mục tiêu
FR-AP-13 (PRD 8.13): hiệu quả thật của video đã đăng (054) được dùng lại khi chấm điểm/chọn chủ đề ngày sau, theo từng kênh. Ví dụ lý do hiển thị trong kế hoạch: "Chủ đề dạng "đang trending" của kênh đang hiệu quả hơn trung bình 25% (10 video) → ưu tiên cao hơn (×1,10)."

## Yêu cầu
- FR-AP-13a (dữ liệu): từ bảng `video_metrics` (054) của các video do app đăng (có `publish.youtube.video_id` trong kế hoạch 60 ngày gần nhất) và **đã đủ 3 ngày tuổi** kể từ ngày đầu có lượt xem (video riêng tư chưa công khai chưa có lượt xem nên không bị tính 0). Hiệu quả một video = lượt xem trung bình mỗi ngày trong 7 ngày đầu.
- FR-AP-13b (nhóm): năm chiều — dạng ứng viên (`kind`: competitor / competitor_evergreen / trending / trend / news), chủ đề trụ cột (`pillar`, đọc từ `research/<ngày>.json` của ngày lập kế hoạch), kênh đối thủ nguồn, workflow, khung giờ đăng (`HH:MM`). `ratio` = trung vị hiệu quả nhóm / trung vị hiệu quả cả kênh.
- FR-AP-13c (hệ số): `multiplier = 1 + clamp(ratio − 1, ±0,3) · n/(n+5)` → luôn trong [0,7; 1,3], co về 1 khi ít mẫu; nhóm < 2 video không có hệ số; < 5 video đủ tuổi → `enough_data: false` và không ảnh hưởng gì. Xác định: cùng dữ liệu → cùng kết quả (thứ tự đầu vào không ảnh hưởng).
- FR-AP-13d (file, D3 5.21): `autopilot/learning.json` mỗi kênh (`ChannelLearning`, có schema JSON), làm mới mỗi lần lập kế hoạch ngày, ghi qua WriteStore chỉ khi nội dung đổi (bỏ qua `generated_at`).
- FR-AP-13e (áp dụng, 051): khi chọn chủ đề, thứ hạng = điểm gốc × hệ số ứng viên (tích hệ số `kind`, `pillar`, nguồn đối thủ, kẹp [0,7; 1,3]). **Chỉ đổi thứ tự**: điểm gốc trong nghiên cứu, `item.score` và `autopilot.min_score` không đổi (học không hạ chuẩn chất lượng). Mục kế hoạch thêm các câu lý do tiếng Việt cho từng chiều có chênh lệch ≥ 2%. Chiều workflow và khung giờ chỉ được ghi để xem, chưa dùng khi chọn.
- FR-AP-13f (điều khiển): khóa `autopilot.learning` (mặc định true; app và kênh) tắt học. Lỗi khi học không chặn việc lập kế hoạch (bỏ qua học). IPC `learning.get {channel?}` (D10) và tool Gateway `learning.get` (phiên `main` và `ops`, D4 2.4) để xem nhóm nào hiệu quả hơn/kém.

## AC
- `tests/unit/learning.test.ts` (chặn và co hệ số, không đủ dữ liệu, trung vị/ratio, xác định, lý do tiếng Việt, chỉ đổi thứ hạng không đổi `min_score`/điểm gốc, áp vào `buildPlan`).
- `tests/integration/learning.test.ts` (học từ SQLite + kế hoạch cũ, `learning.json`, idempotent, bỏ video chưa đủ tuổi / riêng tư chưa có lượt xem, tắt bằng khóa, vượt thứ hạng trong `planToday` kèm lý do, IPC + tool).
- `tests/contract/gateway-policy.test.ts` (`learning.get` main + ops).

## Làm rõ
- [NEEDS CLARIFICATION: dùng chiều workflow và khung giờ khi chọn (chọn workflow/giờ đăng theo hiệu quả).] Đã cài: chỉ ghi `learning.json`; chọn workflow/giờ vẫn theo luật 051. Áp dụng cần thêm luật chống thiên lệch (ví dụ khám phá 20%).
- [NEEDS CLARIFICATION: CTR/giữ chân khán giả thay cho lượt xem làm thước đo.] Đã cài: lượt xem/ngày trong 7 ngày đầu (có sẵn từ 054). Thêm CTR khi có Reporting API.
- [NEEDS CLARIFICATION: kênh tiêu chuẩn so sánh — chỉ video của chính kênh hay cả video đối thủ.] Đã cài: chỉ video của kênh (không so sánh chéo).
- Hạn chế đã biết: TikTok/Facebook chưa có số liệu (chỉ YouTube); video làm tay không có trong kế hoạch nên không học; ít mẫu ban đầu (< 5) thì không ảnh hưởng.
