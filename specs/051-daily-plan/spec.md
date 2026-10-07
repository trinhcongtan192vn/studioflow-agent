# 051 — Kế hoạch ngày Autopilot (chủ đề, workflow, khung giờ đăng, lý do)

## Mục tiêu
FR-AP-06 (PRD 8.13): app lập kế hoạch ngày cho mọi kênh Autopilot — chủ đề, workflow, khung giờ đăng, lý do — và người dùng xem/sửa được. Đầu vào: nghiên cứu (049) + năng lực (050) + cài đặt kênh (047). Đầu ra là việc cho 052 (tự tạo video theo kế hoạch). Luật chi tiết: FN-051 (`docs/feature-notes/051-plan.md`); quyết định: `research.md`.

## Quyết định (chủ dự án, 2026-10-07)
- `autopilot.max_per_day` **chỉ đếm video do Autopilot tạo**, không đếm video làm tay; kế hoạch ngày là nguồn sự thật cho số đó. (Giải quyết `[NEEDS CLARIFICATION]` thứ nhất của 050: `done_today` của năng lực = số mục kế hoạch hôm nay đã bắt đầu — `in_production`, `produced`, `failed`.)

## Yêu cầu
- FR-AP-06a (artifact): `autopilot/plans/<YYYY-MM-DD>.json` ở gốc kênh (D3 mục 1, 5.18, schema `DailyPlan`, ID `pi_`), ngày theo `publish.timezone` của kênh, ghi qua module ghi. `DailyPlan {schema_version, channel_id, date, generated_at, capacity {videos, limiting_factor, reasons[]}, notes?[], items[]}`; `PlanItem {id, status planned|skipped|in_production|produced|failed, candidate_id, title, angle, source {kind, url?, source_channel?}, workflow_id, output_profile, publish_at (ISO có offset) | null, platforms[], score, reasons[], video_id?, note?}`.
- FR-AP-06b (chọn chủ đề, thuần): số chỗ = `min(videos năng lực − mục planned, max_per_day − mục chưa bỏ qua)`; xếp ứng viên nghiên cứu theo điểm; loại ứng viên đã lập trong 14 ngày gần nhất của kênh (cùng `candidate_id` hoặc tiêu đề gần trùng, Jaccard ≥ 0,6 theo `research/score.ts`, mọi trạng thái kể cả `skipped`) và chủ đề kênh đã làm; đa dạng — tránh hai mục cùng nguồn (kênh đối thủ / video nguồn) hoặc cùng chủ đề trụ cột trong một ngày khi còn lựa chọn khác. Nghiên cứu không có ứng viên đối thủ mới → vẫn lập từ evergreen / trending / trend / tin; không có gì → 0 mục và `notes` nêu lý do tiếng Việt.
- FR-AP-06c (workflow, dạng xuất): chỉ workflow được phép (`autopilot.workflows`, rỗng = mọi workflow cài sẵn); video nguồn ≤ 60 giây và kênh dùng được `shorts` → `shorts`; ngược lại `workflow.default` nếu được phép, không thì workflow dài đầu tiên; dạng xuất = phần tử đầu `output_profiles` của workflow.
- FR-AP-06d (giờ đăng): theo `publish.slots` + `publish.timezone` (`HH:MM`, `<thứ> HH:MM`, `<thứ>-<thứ> HH:MM`), khung gần nhất **sau hẳn** (bây giờ + thời gian làm ước tính của mục đó, các mục làm lần lượt; `est_ms` theo workflow từ 050), chưa dùng cho mục khác của kênh (hôm nay và các ngày sau); hết khung hôm nay → ngày kế; không có khung → `null`. Nền tảng = `publish.platforms`.
- FR-AP-06e (lập lại idempotent): `planToday` giữ mọi mục đã có (kể cả `planned`, người dùng có thể đã sửa); mục `in_production` / `produced` / `failed` / `skipped` không bị đụng; chỉ lấp chỗ trống. Không ghi file khi không có gì đổi.
- FR-AP-06f (orchestration): `planToday({channels, now, …})` (`packages/core/src/autopilot/plan.ts`): `autopilot.paused` → không làm gì; mỗi kênh dùng `research/<hôm nay>.json` nếu có, chưa có → `scanChannel` (lỗi quét → lập từ nghiên cứu rỗng + ghi chú); một lần tính năng lực cho cả nhóm kênh; ghi file kế hoạch. Chưa có bộ lịch chạy hằng ngày và chưa tạo video (052).
- FR-AP-06g (IPC + tool): IPC `autopilot.plan.get {channel?, date?}` (mặc định mọi kênh Autopilot, hôm nay), `autopilot.plan.run {date?}` → `{job_id}` (job `autopilot.plan`, D4 2.3; `date` chỉ nhận hôm nay), `autopilot.plan.update {channel, date, item_id, patch {status?: skipped|planned, title?, angle?, workflow_id?, publish_at?}}` → `{item}`. Kiểm: workflow thuộc danh sách cho phép (đổi workflow → dạng xuất theo workflow mới), `publish_at` ISO 8601 có offset hoặc null, không sửa mục `in_production` / `produced` / `failed`, khôi phục mục `skipped` không được vượt `max_per_day` — lỗi `E_SCHEMA_INVALID`; không thấy mục `E_ID_UNKNOWN`; chưa có kế hoạch `E_FILE_NOT_FOUND`. Tool Gateway `autopilot.plan_get`, `autopilot.plan_run` (job), `autopilot.plan_update` — phiên `main` (D4 2.4, D5 4).
- IPC `autopilot.capacity` (050) nay lấy `done_today` từ kế hoạch ngày thay vì 0.

## Ngoài phạm vi
- Lịch tự chạy `planToday` hằng ngày, tạo video theo kế hoạch, cập nhật `status` / `video_id` (052); đăng bài theo `publish_at` (053); giao diện màn kế hoạch (UI sau).

## AC
- `tests/unit/autopilot-plan.test.ts`: xếp hạng, không lặp 14 ngày (ID, tiêu đề gần trùng, mục `skipped`), chủ đề kênh đã làm, đa dạng nguồn/trụ cột và hạ ràng buộc khi hết lựa chọn, nghiên cứu rỗng, `freeSlots` chỉ đếm mục Autopilot; luật workflow/dạng xuất; khung giờ (múi giờ, `sat 09:00`, `mon-fri 07:15`, khoảng vòng, giờ mùa hè Berlin, tràn sang ngày sau, khung đã dùng, không khung → null); `buildPlan` lập lại idempotent, giữ mục không phải `planned`, chỉ lấp chỗ trống, ghi chú lý do.
- `tests/integration/autopilot-plan.test.ts`: hai kênh trên bản sao kênh mẫu với file nghiên cứu fixture và năng lực thật (`capacityToday`, đầu vào giả) → file kế hoạch hợp lệ schema; chạy lại không đổi (hash file); lập lại giữ mục bắt đầu/bỏ qua; video làm tay không tính vào trần; không lặp chủ đề 14 ngày; nghiên cứu rỗng; quét khi chưa có nghiên cứu và khi quét lỗi; `autopilot.paused`; múi giờ; tool `autopilot.plan_*` qua Gateway (job, sửa, các luật từ chối, chỉ `main`).
- `tests/integration/host.test.ts`: IPC `autopilot.plan.get/run/update` + `autopilot.capacity` đếm mục đã bắt đầu.
- `tests/contract/domain-schemas.test.ts` (mẫu `daily-plan.json`), `gateway-policy.test.ts` (3 tool chỉ `main`).

## Làm rõ
- [NEEDS CLARIFICATION: có đặt ngưỡng điểm tối thiểu cho ứng viên được lập không?] Mặc định an toàn: không đặt — số mục bị chặn bởi năng lực và trần ngày; ứng viên điểm thấp vẫn được lập khi còn chỗ (người dùng bỏ qua được).
- [NEEDS CLARIFICATION: kế hoạch cho ngày khác hôm nay (lập trước ngày mai)?] Mặc định: `autopilot.plan.run` chỉ nhận hôm nay vì năng lực (050) chỉ tính cho hôm nay; giờ đăng có thể rơi sang ngày sau.
- [NEEDS CLARIFICATION: mục `planned` của ngày hôm qua mà chưa làm có chuyển sang hôm nay không?] Mặc định: không; chủ đề đó vẫn bị chặn 14 ngày (mọi trạng thái) — người dùng đổi sang hôm nay bằng cách bỏ qua mục cũ rồi thêm tay (thêm mục tay chưa có trong 051).
- [NEEDS CLARIFICATION: thêm mục tay (người dùng/agent tự đưa chủ đề) vào kế hoạch?] Chưa làm: D3 5.18 đã dành `candidate_id` dạng `manual:<id>`; thêm khi có màn kế hoạch.
- Thời gian làm ước tính của mục planned có sẵn (trước mục mới) lấy theo `est_ms` workflow; không tính phần việc còn lại của video đang chạy dở (đã trừ trong quỹ thời gian của năng lực 050, không trong giờ đăng).
