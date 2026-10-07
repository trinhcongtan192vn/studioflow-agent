# FN-051 — Kế hoạch ngày Autopilot: chọn chủ đề, workflow, khung giờ đăng

Gợi ý, không ràng buộc (CLAUDE.md mục 6). Hợp đồng file: D3 mục 5.18; tool: D4 mục 2.4; IPC: D10 mục 4; chính sách: D5 mục 4. Hằng số nằm trong `packages/core/src/autopilot/plan.ts` (`PLAN_CONSTANTS`), không phải khóa cấu hình.

## Luồng `planToday`
1. `autopilot.paused` (tầng app) → không làm gì, trả `paused: true`.
2. Mỗi kênh: dùng `research/<hôm nay>.json` nếu có, chưa có → `scanChannel` (lỗi quét ghi vào `notes`, vẫn lập từ ứng viên rỗng).
3. Một lần gọi mô hình năng lực (050) cho mọi kênh cùng lúc (chia vòng tròn), với `done_today` = số mục của kế hoạch hôm nay đã bắt đầu (`in_production`, `produced`, `failed`).
4. Mỗi kênh: chọn ứng viên → chọn workflow/dạng xuất → gán khung giờ đăng → ghi `autopilot/plans/<ngày>.json` qua module ghi.

## Số mục được lập
- `autopilot.max_per_day` chỉ đếm video do Autopilot tạo; kế hoạch ngày là nguồn sự thật (quyết định của chủ dự án, 2026-10-07).
- Chỗ trống = `min(videos − số mục planned, max_per_day − số mục không skipped)`, không âm. `videos` là số khả thi của kênh từ 050 (đã trừ phần đã bắt đầu).
- Lập lại trong ngày: mọi mục đã có được giữ (kể cả `planned` — người dùng có thể đã sửa) và chỉ lấp chỗ trống → chạy lại không đổi gì khi năng lực không tăng.

## Chọn ứng viên (hàm thuần `selectCandidates`)
1. Loại ứng viên: trùng `candidate_id` hoặc gần trùng tiêu đề (Jaccard ≥ 0,6 theo `research/score.ts`) với mục trong kế hoạch 14 ngày gần nhất của kênh (mọi trạng thái, kể cả `skipped` — người dùng đã từ chối); ứng viên nghiên cứu đã chấm gần trùng video kênh đã làm (`metrics.similarity` ≥ 0,6); gần trùng với ứng viên vừa chọn trong cùng ngày.
2. Xếp theo điểm giảm dần (hòa → thứ tự trong file nghiên cứu).
3. Chọn tham lam, đa dạng theo ba bậc: (a) khác nguồn (kênh đối thủ / video nguồn) **và** khác chủ đề trụ cột với các mục đã có trong ngày; (b) chỉ khác nguồn; (c) không ràng buộc. Chỉ hạ bậc khi bậc trên không còn ứng viên.
4. Không có ứng viên nào → 0 mục, `notes` nêu lý do tiếng Việt (nghiên cứu rỗng, hoặc đã dùng hết trong 14 ngày).
5. Không đặt ngưỡng điểm tối thiểu: số mục bị chặn bởi năng lực và trần ngày. [Mở: có nên bỏ ứng viên điểm quá thấp?]

Ứng viên Shorts của đối thủ (`duration_s` ≤ 60) vẫn được xét; việc dùng workflow nào do bước 3 dưới đây quyết.

## Chọn workflow và dạng xuất
Tập cho phép = `autopilot.workflows` (giữ thứ tự người dùng) lọc theo workflow đã cài; rỗng = mọi workflow cài sẵn. Tập rỗng → 0 mục + lý do.
1. `duration_s` ≤ 60 **và** `shorts` thuộc tập cho phép → `shorts`.
2. Ngược lại → `workflow.default` (tầng kênh/app) nếu thuộc tập cho phép; không thì workflow dài đầu tiên (khác `shorts`) trong tập; chỉ còn `shorts` → dùng `shorts`.
3. Dạng xuất = `output_profiles[0]` của workflow (D3: phần tử đầu là mặc định; shorts → `yt-shorts-1080x1920`).

## Khung giờ đăng
- `publish.slots` theo `publish.timezone` của kênh: `HH:MM` (mọi ngày), `<thứ> HH:MM` (một ngày), `<thứ>-<thứ> HH:MM` (khoảng, có thể vòng như `sat-mon`).
- Mục thứ k làm xong lúc `now + Σ est_ms` (các mục planned đã có trước nó, rồi các mục mới, làm lần lượt; `est_ms` theo workflow từ 050, thiếu → mặc định FN-050). Chọn khung giờ gần nhất **sau hẳn** lúc đó, chưa bị mục khác (chưa `skipped`) của cùng kênh dùng — xét kế hoạch hôm nay và các ngày trước còn giờ đăng ở tương lai; hôm nay hết khung giờ → ngày kế tiếp. Quét tối đa 30 ngày; không có khung giờ nào → `publish_at: null`.
- Giờ ghi dạng ISO có offset của múi giờ kênh (xử lý giờ mùa hè).
- Nền tảng = `publish.platforms` của kênh.

## Sửa kế hoạch (`autopilot.plan.update`)
- `status`: chỉ `skipped` ↔ `planned`; `title`, `angle`: chuỗi không rỗng; `workflow_id`: thuộc tập cho phép (đổi workflow → dạng xuất = mặc định của workflow mới); `publish_at`: ISO 8601 có offset hoặc `null`.
- Mục `in_production` / `produced` / `failed` không sửa được (`E_SCHEMA_INVALID`); mục không tồn tại → `E_ID_UNKNOWN`; kế hoạch chưa có → `E_FILE_NOT_FOUND`.
