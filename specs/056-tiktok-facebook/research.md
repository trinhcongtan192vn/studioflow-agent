# 056 — Ghi chú nghiên cứu

- **TikTok Content Posting API** (Direct Post, FILE_UPLOAD): `video/init` trả `publish_id` + `upload_url` (hiệu lực ~1 giờ); khúc 5–64 MiB, khúc cuối tới 128 MiB (nên `total_chunk_count = floor(size/chunk)`); `status/fetch` có `PROCESSING_UPLOAD → PUBLISH_COMPLETE | FAILED`. Ứng dụng chưa kiểm duyệt: `privacy_level` chỉ nhận `SELF_ONLY` và tài khoản đăng phải để riêng tư.
- **Facebook Reels** (Graph API v21): `video_reels` start/finish; tệp gửi `rupload.facebook.com` với header `offset`, `file_size` và `Authorization: OAuth`. `video_state: SCHEDULED` + `scheduled_publish_time` (từ 10 phút đến 30 ngày; ở đây kẹp [+11 phút, +29 ngày]). Cần token Trang có `pages_manage_posts`.
- **Thiết kế**: không dựng khung mới — `PlatformPublisher` của 053 đủ; chỉ thêm `due` cho nền tảng không hẹn giờ. Token đi qua header, không URL, để logger/trace không bắt gặp.
- **Không lưu URI phiên tải lên** (TikTok `upload_url` hết hạn sau ~1 giờ; Facebook dùng URL suy ra từ `video_id`): chống tải trùng dựa vào `publish_id`/`video_id` ghi ngay vào kế hoạch.
- **Lệch gợi ý**: `docs/feature-notes/` không có ghi chú cho 056.
