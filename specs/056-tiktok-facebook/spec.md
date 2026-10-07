# 056 — Đăng TikTok và Facebook Reels

## Mục tiêu
FR-AP-10 (PRD 8.13): đăng video dọc lên TikTok và Facebook Page Reels theo cùng cơ chế với YouTube (053): hàng đợi chung, thử lại, trạng thái trong kế hoạch ngày, xem trước Telegram với nút Hủy đăng / Đăng ngay.

## Giới hạn nền tảng (đã chốt với chủ dự án)
- TikTok chưa qua kiểm duyệt Content Posting API: mọi bài đăng chỉ được `SELF_ONLY`. Khóa app `publish.tiktok.audited` (mặc định **false**): false → `SELF_ONLY`, trạng thái `private`, báo người dùng tự công khai trong app TikTok; true → bài `PUBLIC_TO_EVERYONE`, chỉ tải lên khi tới giờ công khai.
- TikTok không có hẹn giờ qua API; Facebook Reels có (`scheduled_publish_time`).

## Yêu cầu
- FR-AP-10a (khung chung): thêm `PlatformPublisher.due?(ctx)` — nền tảng không hẹn giờ được thì chưa tới giờ chưa tải lên (mục `pending`, ghi chú "Chờ tới …"); `PublishService` giữ nguyên hàng đợi/thử lại (tối đa 3 lần)/nhật ký/xem trước. Hai bộ đăng mới đăng ký trong `createCore`.
- FR-AP-10b (chỉ video dọc): chỉ hồ sơ xuất dọc 9:16 (`isVerticalProfile`: `<rộng>x<cao>` trong id với cao > rộng, hoặc tên `shorts`/`vertical`…). Bản ngang → trạng thái `cancelled`, `note: "Bỏ qua <nền tảng>: … (video ngang)"`, nhật ký `publish.skipped`, không gọi mạng.
- FR-AP-10c (TikTok, D4 9.8): `init` FILE_UPLOAD (khúc 10 MiB, khúc cuối nhận phần dư; video < 5 MiB một khúc) → `PUT` từng khúc (lỗi mạng/5xx/429 lùi 1–8 s, thử lại 4 lần) → hỏi `status/fetch` (3 s, tối đa 40 lần) tới `PUBLISH_COMPLETE`/`SEND_TO_USER_INBOX`; `FAILED` → lỗi kèm `fail_reason`. `publish_id` ghi vào kế hoạch ngay sau `init` → lượt sau chỉ hỏi trạng thái, không tải trùng. Token sai → `E_PERMISSION_DECLINED` ("dán token mới trong Cài đặt kênh"). Hủy: không xóa được qua API → `cancelled` kèm ghi chú trung thực; Đăng ngay: trả hướng dẫn.
- FR-AP-10d (Facebook Reels, D4 9.8): `video_reels` start → `POST rupload` (header `offset`, `file_size`) → finish `SCHEDULED` tại max(giờ trong kế hoạch, lúc tải + `publish.veto_hours`) kẹp trong [+11 phút, +29 ngày]; `video_id` ghi ngay sau start (tiếp tục không mở phiên mới). Hủy → `DELETE /{video_id}`; Đăng ngay → `is_published: true`; làm mới `scheduled` → `public` khi Facebook báo `published`. ID Trang ở `publish.facebook.page_id` (tầng kênh).
- FR-AP-10e (token): người dùng dán token trong Cài đặt kênh — IPC `publish.tiktok.set_token {channel, token}`, `publish.facebook.set_token {channel, token, page_id?}`, `publish.<nền tảng>.status` / `.disconnect` (D10). Lưu bí mật `oauth:tiktok:<channel_id>` / `oauth:facebook:<channel_id>` qua `SecretStore` (qua `main`, D5 5.4); không bao giờ trả lại giao diện, không vào file/log/trace/tin Telegram/URL (token chỉ ở header `Authorization`). Token < 20 hoặc > 2000 ký tự hoặc có khoảng trắng bị từ chối `E_SCHEMA_INVALID`.
- Chưa kết nối (không token, hoặc Facebook thiếu ID Trang) → `pending` kèm hướng dẫn tiếng Việt, tự đăng khi kết nối.

## AC
- `tests/unit/social.test.ts` (dạng dọc, tên bí mật, thử lại có lùi).
- `tests/integration/social-publish.test.ts` (TikTok: init/khúc/trạng thái, SELF_ONLY, khúc 10 MiB, thử lại 503, tiếp tục không tải trùng, FAILED/token sai, đã kiểm duyệt chờ giờ rồi PUBLIC, hủy/đăng ngay; Facebook: start/upload/finish SCHEDULED, kẹp giờ, làm mới/đăng ngay/hủy, thử lại, tiếp tục sau sập, lỗi 190; video ngang bị bỏ qua; chưa kết nối; xem trước Telegram từng nền tảng; IPC token; không rò token).

## Làm rõ
- [NEEDS CLARIFICATION: OAuth đầy đủ cho TikTok (Login Kit) và Facebook (Facebook Login + đổi sang token Trang dài hạn).] Đã cài: dán token thủ công; làm OAuth sau.
- [NEEDS CLARIFICATION: Facebook "Đăng ngay" cho Reels đã hẹn giờ — trường Graph API chính xác (`is_published` hay `published`).] Đã cài `is_published: true`, chưa kiểm chứng với tài khoản thật; nếu lỗi, người dùng đăng tay.
- [NEEDS CLARIFICATION: TikTok đã kiểm duyệt — cửa sổ phản đối.] Đã cài: không tải lên trước giờ công khai nên không có tin xem trước để hủy; hủy = Hủy trên Telegram/IPC khi mục còn `pending`. Cân nhắc thêm tin nhắc trước giờ đăng.
- [NEEDS CLARIFICATION: URL bài TikTok.] API chỉ trả post id khi công khai; với `SELF_ONLY` kế hoạch không có `url`.
- [NEEDS CLARIFICATION: Facebook Reels tối đa 90 giây, TikTok tối đa 10 phút; video dài hơn.] Chưa kiểm tra thời lượng; workflow `shorts` giới hạn 60 s.
