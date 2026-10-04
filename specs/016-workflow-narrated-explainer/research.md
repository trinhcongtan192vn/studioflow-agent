# Research — 016

## R4. Không có tốc độ đọc (quyết định 2026-10-04, sửa spec)
- Tan: tốc độ giọng phụ thuộc nội dung, kịch bản, từng cảnh → đặt số từ/phút (cố định hay đo theo giọng) **không có nghĩa**. Bản đo theo giọng (commit 6634bda) đã gỡ.
- Spec sửa: D3 7.2 bỏ `script.wpm.<lang>`, `check.length_tolerance`; D6 4.2 bỏ `length`, `read_time`, thêm `audio_duration` (gate bước `voice`; `finalize` dùng `params.source: timeline`); biến prompt `{{target_words}}` → `{{target_duration}}`; `publish-meta` đọc `audio_meta.json` cho mốc chương; tech-defaults, FN-016/029/030 cập nhật theo.
- Kịch bản chỉ nhận thời lượng mục tiêu dạng chữ (không có trong brief → gợi ý 2 phút, không phải gate). Sau `voice`, lệch quá `check.duration_tolerance` → gate trượt kèm thời lượng thật từng beat → agent sửa đúng beat lệch, `voice` chỉ sinh lại line đổi (cache theo nội dung).
- Bản ghi LLM của 009 (`refine-live`) gán lại khóa: thay câu độ dài trong prompt và bỏ các issue `length`/`read_time` khỏi request; phản hồi giữ nguyên.

## R1. Không chạy script upstream
- Như 011 R1: app tự lắp index/transition/caption; skill StudioFlow mô tả định dạng `STORYBOARD.md` D3 (khối `sf-scene`/`sf-frame`, không ghi ID — `artifact.write` gán). Delta FN-016 (bỏ sinh ảnh M1, storyboard D3, captions sau frames) thể hiện trực tiếp trong manifest + skill; `sf ext build` (fork/delta tự động) để sau.

## R2. Finalize
- Duyệt cuối trên **render nháp** (FN-016) + contact sheet (`hyperframes snapshot --at <điểm giữa frame>` ra thư mục tạm → `.sf/snapshots/`). Gate thời lượng (D6 mục 2) là objective `audio_duration` với `params.source: timeline` (R4); brief không có `target_duration_ms` → qua.

## R3. Phát hiện khi nghiệm thu thật (2026-10-04, Claude + RTX 5060 Ti)
1. **Hết hạn mức gói Claude** trả về như một "kết quả" (`You've hit your session limit…`, 0 token) → `text.claude` coi là nội dung → critic `E_REVIEW_FORMAT`. Sửa: nhận diện → `E_RUNTIME_RATE_LIMIT` (có test).
2. **Phiên `main` không nạp plugin gói workflow** (D5 mục 3 yêu cầu) → agent không thấy skill `narrated-explainer`, dừng ở bước `music`. Sửa: `CoreHost` truyền thư mục gói workflow của video vào `plugins` (mở phiên mới khi đổi workflow); chỉ dẫn bước nêu tên skill.
3. **Kho nhạc trống**: agent chờ người dùng thay vì ghi `music: none`. Skill nói rõ đây là trường hợp bình thường, bắt buộc báo xong.
4. **Duyệt lại sau khi mất hiệu lực giữ hash cũ** (bước `music` sửa `STORYBOARD.md` → điểm duyệt storyboard về `pending` đúng D6 3.1, nhưng duyệt lại vẫn `pending`). Sửa: `approve` cập nhật hash theo nội dung hiện tại (test 007 bổ sung).
5. **Tốc độ đọc**: OmniVoice đọc tiếng Việt ~232 từ/phút (139 từ → 36 s) so với mặc định `script.wpm.vi` = 150 → video ngắn hơn mục tiêu ~35%, gate thời lượng của `finalize` chặn (đúng thiết kế). Quyết định của Tan (2026-10-04) → R4.
6. Bước `music` sửa `STORYBOARD.md` làm điểm duyệt storyboard cần duyệt lại (D6 3.1). Hợp lý (nội dung storyboard đổi) nhưng thêm một lần duyệt; xem lại khi làm D7/FN-016 tiếp.
