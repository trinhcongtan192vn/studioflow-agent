# Research — 016

## R1. Không chạy script upstream
- Như 011 R1: app tự lắp index/transition/caption; skill StudioFlow mô tả định dạng `STORYBOARD.md` D3 (khối `sf-scene`/`sf-frame`, không ghi ID — `artifact.write` gán). Delta FN-016 (bỏ sinh ảnh M1, storyboard D3, captions sau frames) thể hiện trực tiếp trong manifest + skill; `sf ext build` (fork/delta tự động) để sau.

## R2. Finalize
- Duyệt cuối trên **render nháp** (FN-016) + contact sheet (`hyperframes snapshot --at <điểm giữa frame>` ra thư mục tạm → `.sf/snapshots/`). Gate `duration` (D6 mục 2) là objective mới; brief không có `target_duration_ms` → qua.

## R3. Phát hiện khi nghiệm thu thật (2026-10-04, Claude + RTX 5060 Ti)
1. **Hết hạn mức gói Claude** trả về như một "kết quả" (`You've hit your session limit…`, 0 token) → `text.claude` coi là nội dung → critic `E_REVIEW_FORMAT`. Sửa: nhận diện → `E_RUNTIME_RATE_LIMIT` (có test).
2. **Phiên `main` không nạp plugin gói workflow** (D5 mục 3 yêu cầu) → agent không thấy skill `narrated-explainer`, dừng ở bước `music`. Sửa: `CoreHost` truyền thư mục gói workflow của video vào `plugins` (mở phiên mới khi đổi workflow); chỉ dẫn bước nêu tên skill.
3. **Kho nhạc trống**: agent chờ người dùng thay vì ghi `music: none`. Skill nói rõ đây là trường hợp bình thường, bắt buộc báo xong.
4. **Duyệt lại sau khi mất hiệu lực giữ hash cũ** (bước `music` sửa `STORYBOARD.md` → điểm duyệt storyboard về `pending` đúng D6 3.1, nhưng duyệt lại vẫn `pending`). Sửa: `approve` cập nhật hash theo nội dung hiện tại (test 007 bổ sung).
5. **Tốc độ đọc**: OmniVoice đọc tiếng Việt ~232 từ/phút (139 từ → 36 s), mặc định `script.wpm.vi` = 150 (D3 7.2) → video ngắn hơn mục tiêu ~35% và gate `duration` của `finalize` chặn (đúng thiết kế). `script.wpm.<lang>` chỉ có tầng channel/video → hiệu chuẩn theo giọng của kênh; nghiệm thu đặt 230. **Đề xuất cho Tan**: đổi mặc định vi trong D3 7.2 (~220–230 với OmniVoice) hoặc để bước `voice.profile` đo tốc độ giọng mẫu và ghi `script.wpm.vi` của kênh.
6. Bước `music` sửa `STORYBOARD.md` làm điểm duyệt storyboard cần duyệt lại (D6 3.1). Hợp lý (nội dung storyboard đổi) nhưng thêm một lần duyệt; xem lại khi làm D7/FN-016 tiếp.
