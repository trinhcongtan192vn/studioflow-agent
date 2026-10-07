# 051 — Quyết định kỹ thuật

## R1. Kế hoạch giữ mọi mục đã có, kể cả `planned`
Yêu cầu: lập lại trong ngày giữ mục không `planned` và chỉ lấp chỗ trống. Mục `planned` cũng giữ nguyên: người dùng có thể đã đổi tiêu đề/giờ/workflow (FR-AP-06 "sửa được") và chạy lại phải idempotent. Chỗ trống = `min(videos − planned, max_per_day − chưa bỏ qua)`. Năng lực (050) được gọi với `done_today` = số mục đã **bắt đầu** (không tính `planned`) nên `videos` đã gồm các mục `planned` còn phải làm — tránh đếm hai lần và tránh lập thêm mỗi lần chạy lại. Hệ quả: nếu năng lực giảm trong ngày, mục `planned` không bị rút lại (người dùng bỏ qua tay hoặc 052 bỏ khi hết tài nguyên).

## R2. `max_per_day` chỉ đếm mục Autopilot
Quyết định của chủ dự án: kế hoạch ngày là nguồn sự thật, video làm tay không tính. `done_today` của 050 trước đây là 0 (chưa có dấu Autopilot); nay `autopilotDoneToday` đọc kế hoạch (in_production / produced / failed). `skipped` không tính (không tạo video). `failed` tính: video đã được tạo và đã dùng tài nguyên.

## R3. Chống lặp 14 ngày dùng mọi trạng thái, kể cả `skipped`
Người dùng bỏ qua một mục là tín hiệu từ chối chủ đề; lập lại ngay hôm sau sẽ gây khó chịu. Cái giá: mục `planned` không làm kịp cũng chặn chủ đề 14 ngày (đã nêu trong spec). So tiêu đề dùng đúng `tokenize` + `jaccard` + ngưỡng 0,6 của 049 để "gần trùng" nhất quán giữa nghiên cứu và kế hoạch; ứng viên nghiên cứu đã chấm `metrics.similarity` ≥ 0,6 so với video kênh đã làm bị loại hẳn (049 chỉ trừ điểm).

## R4. Đa dạng bằng ba bậc ràng buộc, tham lam
Cần "tránh khi còn lựa chọn khác" → tham lam theo điểm với ba bậc (khác nguồn và khác trụ cột → chỉ khác nguồn → không ràng buộc). Nguồn = kênh đối thủ nếu có, không thì chính ID ứng viên (trend/tin không bao giờ "cùng nguồn"). Trụ cột của mục đã có trong ngày tra qua `candidate_id` trong file nghiên cứu (PlanItem không lưu trụ cột để giữ D3 gọn). Hai ứng viên gần trùng tiêu đề không cùng một ngày.

## R5. Giờ đăng tính bằng `Intl`, không thêm phụ thuộc
Đổi "ngày + HH:MM + múi giờ" sang thời điểm UTC bằng hai vòng hiệu chỉnh offset (đúng khi đổi giờ mùa hè); ghi ISO có offset dạng `+07:00` để người đọc thấy giờ địa phương. Khung giờ đã dùng lấy từ mọi kế hoạch của kênh trong cửa sổ 14 ngày trở đi (kể cả tràn từ hôm qua), bỏ mục `skipped`. Thời gian sẵn sàng của mục k = bây giờ + Σ `est_ms` (mục planned có sẵn rồi các mục mới); không mô hình hóa khung giờ làm việc (`autopilot.work_window`) cho giờ đăng — năng lực 050 đã giới hạn số video theo khung giờ đó.

## R6. Hằng số trong code, không thêm khóa cấu hình
14 ngày, 0,6, 60 giây, chân trời 30 ngày là hằng số `PLAN_CONSTANTS` (FN-051). Chưa có số liệu thật để biết người dùng cần chỉnh (hiệu chỉnh ở 057, FR-AP-13). Không thêm khóa D3 7.2 → hợp đồng cấu hình không đổi.

## R7. `DailyPlan.notes` (ngoài mô tả ban đầu)
Yêu cầu "không có gì → 0 mục kèm lý do tiếng Việt" cần chỗ ghi lý do ở cấp kế hoạch (không thuộc năng lực, không thuộc một mục) → trường tùy chọn `notes[]`. `capacity.reasons` giữ nguyên lý do chung của 050 (nêu cả các kênh khác; chấp nhận vì cùng người dùng).

## R8. Job `autopilot.plan`, engine `autopilot`
Lập kế hoạch có thể quét nghiên cứu qua mạng → > 2 s → job (D4 2.3), như `research.scan`. Một job mỗi lúc (engine `autopilot`) vì cùng đọc/ghi file kế hoạch và dùng chung năng lực. `max_attempts: 1`: lỗi quét đã được ghi vào `notes`. Payload mang danh sách kênh (IPC: mọi kênh quản lý đang bật Autopilot; tool Gateway: kênh của phiên). Năng lực dùng chung `capacityRun` (tách từ host, `autopilot/capacity-run.ts`) để IPC `autopilot.capacity` và bộ lập kế hoạch cùng một logic.

## R9. `autopilot.min_score` là khóa cấu hình tầng kênh
Khác R6 (hằng số): ngưỡng "đủ tốt để làm" phụ thuộc kênh (ngách, độ khắt khe) nên thuộc cấu hình kênh, mặc định 40. Lọc ngay trong `selectCandidates` (sau lọc trùng; `low` đếm riêng để `notes` nêu đúng nguyên nhân). Mục chuyển từ hôm qua không bị lọc lại: người dùng/bộ lập đã chấp nhận chúng. Khóa mới nằm trong D3 7.2 nên `gen-contracts` cập nhật `config-keys` và schema `ChannelConfig`.

## R10. Chuyển mục hôm qua: hai file, thứ tự ghi và tự lành
Chuyển mục = sao sang hôm nay (ID mới) + đóng mục cũ (`skipped`, `note`). Hai file không ghi nguyên tử; ghi file hôm nay trước rồi file hôm qua: nếu dừng giữa chừng, lần chạy sau thấy bản sao hôm nay (cùng `candidate_id`) và chỉ đóng mục cũ — không nhân đôi, không mất mục. Ngược thứ tự có thể làm mất mục. Không thêm trường `carried_from` vào D3: dấu vết nằm ở `reasons` ("Chuyển từ kế hoạch <ngày>") và `note` của mục cũ. Không ghi "đã chuyển N mục" vào `notes` để chạy lại không đổi file (idempotent theo hash). Mục `planned` còn lại khi hết chỗ giữ nguyên ở file hôm qua và được thử lại ở lần chạy sau (cùng ngày) — nhưng sang ngày kế tiếp thì thành "cũ hơn một ngày" và không được chuyển nữa (theo quyết định).
