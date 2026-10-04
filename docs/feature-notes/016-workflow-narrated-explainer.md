# FN-016 — Workflow `narrated-explainer`

> **Ghi chú tính năng — không ràng buộc.** Đầu vào gợi ý cho `/specify` và `/plan` của tính năng 016. Ràng buộc nằm ở spec hệ thống (D3–D13) và constitution; khi tính năng được đặc tả, `specs/016-*/spec.md` thay thế file này.

**Phiên bản:** 1.0 · **Giai đoạn:** M1 · **Phủ:** FR-WF-05, AC-M1-01..03 · **Tính năng:** 016
**Fork từ:** HyperFrames `faceless-explainer` (phiên bản ghim) · **Quy tắc chung:** `workflows-common.md` (FN-common)

## 1. Mục đích
Video thuyết minh 3–15 phút một người dẫn: khoa học phổ thông, giải thích khái niệm, tóm tắt sách. Hình chủ yếu là đồ họa động (vẽ bằng code), ảnh minh họa, chữ.

## 2. Bước

| # | Step id | uses | Duyệt | Ghi chú riêng |
|---|---|---|---|---|
| 0 | (pha briefing) | router | ✓ | Hỏi: chủ đề, khán giả, thông điệp chính, độ dài mục tiêu (mặc định 8 phút) — `brief.questions` |
| 1 | `design` | `design-system` | | |
| 2 | `script` | `script` (`mode: narration`) + refine | ✓ | Rubric `script-default`; 5–9 beat; beat 1 là hook ≤ 30 giây |
| 3 | `storyboard` | `storyboard` | ✓ | M1: không refine; M2: refine bật. Một scene mặc định; tối đa 3 scene |
| 4 | `voice` | `voice` | | Một giọng `voice.id` của kênh |
| 5 | `assets` | `assets` | | M1: `library` → `code` → `user`; M2 thêm `generate` |
| 6 | `look` | `look` | | Từ M3 (`skip_if: phase_before M3`) |
| 7 | `frames` | `frame-build` | | Song song `frame_build.parallel` |
| 8 | `effects`, `overlays` | `effects`, `overlays` | | Từ M3 |
| 9 | `captions` | `captions` | | |
| 10 | `music` | `music` | | Một bài cho cả video trừ khi storyboard có nhiều scene |
| 11 | `finalize` | `finalize` | ✓ | Duyệt trên render nháp + contact sheet |
| 12 | `meta` | `publish-meta` + refine | | Rubric `meta-default` |
| 13 | `render` | `render` (`mode: release`) | | |

## 3. Delta so với `faceless-explainer`
Delta chung (D6 mục 8) + :
- Bỏ bước sinh ảnh mặc định của upstream ở M1 (S3 xác nhận chạy được không có ảnh sinh).
- Storyboard upstream → `STORYBOARD.md` định dạng D3 (adapter chuyển cho script upstream).
- Thứ tự: `captions` chạy sau `frames` để dùng thời lượng thật.

## 4. Tham số mặc định

| Khóa | Giá trị |
|---|---|
| `output.profile` | `yt-1080p30` |
| Thời lượng | kiểm trên audio thật sau bước `voice` (`audio_duration`), không dùng tốc độ đọc cố định |
| Blueprint gợi ý | `title-card`, `key-point`, `diagram-build`, `quote`, `list-reveal`, `map-zoom` (D13) |

## 5. Nghiệm thu
- Dự án mẫu `samples/basic-60s/` chạy hết các bước đến MP4 trong hồi quy.
- AC-M1-01..03 của PRD.
