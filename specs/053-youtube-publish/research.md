# 053 — Quyết định kỹ thuật

## R1. `PublishService` + `PlatformPublisher` (khung chung cho 056)
Hàng đợi, đếm lần thử, ghi `publish.<nền tảng>` vào kế hoạch, nhật ký, xem trước Telegram, hủy/đăng ngay nằm ở một dịch vụ; bộ đăng từng nền tảng chỉ lo giao tiếp nền tảng (`connected`, `eligible`, `upload`, `cancel`, `publishNow`, `refresh`). 056 chỉ thêm hai lớp bộ đăng. `eligible()` cho nền tảng chỉ nhận video dọc: không phù hợp → trạng thái `cancelled` kèm ghi chú "Bỏ qua …" (không phải lỗi, không thử lại).

## R2. Một đường ghi vào kế hoạch
Mọi thay đổi `publish` đi qua `markPlanItem` (051/052), gộp theo nền tảng (`publish.youtube` thay nguyên khối, nền tảng khác giữ nguyên), nên bộ chạy, bộ đăng và người dùng (qua IPC) không ghi đè nhau. Người dùng không sửa `publish` bằng `autopilot.plan.update` (mục `produced` vốn bị khóa).

## R3. Chống tải trùng
Hai chỗ có thể sập sau khi YouTube đã nhận video: (1) giữa các khúc → URI phiên lưu bền, kích thước file phải khớp; (2) sau `videos.insert` trước khi ghi kế hoạch → ghi `video_id` + `uploading` ngay khi có ID, lần sau thấy `uploading` + `video_id` thì bỏ qua insert và chỉ hoàn tất phụ đề/hình. Lỗi phụ đề/hình đại diện không hỏng cả lần đăng (ghi `note`).

## R4. Cửa sổ phản đối và giờ công khai
"Riêng tư + giờ công khai" của chủ dự án = `publishAt` ở YouTube (nền tảng tự làm đúng giờ kể cả khi app tắt) — bền hơn tự cron đổi trạng thái. Giờ thật = max(giờ kế hoạch, tải lên + veto) để người dùng luôn có đủ `publish.veto_hours` để hủy kể cả khi video xong sát giờ đăng. Chưa kiểm duyệt: không `publishAt` (YouTube sẽ ép video về "khóa" hoặc bỏ qua tùy trường hợp), nói rõ với người dùng thay vì hứa tự công khai.

## R5. Quota đếm trước, bền, theo giờ Thái Bình Dương
Quota YouTube đặt lại lúc nửa đêm giờ Thái Bình Dương, không phải giờ kênh; sổ lưu `{date, units}` theo ngày đó. Đếm trước khi gọi vì Google tính cả lời gọi lỗi (đã quy ước ở 049). `capacityRun` đọc sổ này thay vì tham số 0 (050).

## R6. OAuth loopback
Không dùng cổng cố định (đụng cổng) và không dùng "out-of-band" (Google đã tắt). `state` kiểm cả khi sai (từ chối nhưng vẫn chờ) để một yêu cầu lạ tới cổng không phá luồng thật; `prompt=consent` + `access_type=offline` để luôn nhận refresh token; thiếu refresh token (đã cấp quyền trước đó) → hướng dẫn gỡ quyền rồi kết nối lại. Server HTTP chỉ nghe `127.0.0.1`, đóng ngay sau khi xong/hết hạn/ngắt/app đóng.

## R7. Đọc tệp lớn không dùng API ghi
`openSync` bị `no-direct-writes` chặn (regex theo tên) nên đọc khúc bằng `fs/promises.open` + `FileHandle.read` (chỉ đọc). Test dùng file thưa `truncate` 20 MiB nên nhanh.

## R8. Bí mật
Không có token trong kế hoạch, nhật ký, thông báo, xem trước; kiểm bằng test quét toàn bộ đầu ra. Thông báo lỗi OAuth/Google chỉ mang mã lý do, không echo thân phản hồi.
