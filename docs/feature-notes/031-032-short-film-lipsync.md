# FN-031/032 — Workflow `short-film` và lip-sync mức 1

> **Ghi chú tính năng — không ràng buộc.** Đầu vào gợi ý cho `/specify` và `/plan` của tính năng 031. Ràng buộc nằm ở spec hệ thống (D3–D13) và constitution; khi tính năng được đặc tả, `specs/031-*/spec.md` thay thế file này.

**Phiên bản:** 1.0 · **Giai đoạn:** M5 / M5b · **Phủ:** FR-WF-08/09, FR-VO-05, AC-M5-01 · **Tính năng:** 031, 032
**Fork từ:** HyperFrames `general-video` · **Quy tắc chung:** `workflows-common.md` (FN-common) · **Spike:** S10

## 1. Mục đích
Phim ngắn 3–5 phút nhiều nhân vật, có thể có người dẫn truyện; phong cách **comic hoặc 2D phẳng, cố định theo kênh**.

## 2. Bước

| # | Step id | uses | Duyệt | Ghi chú |
|---|---|---|---|---|
| 0 | (pha briefing) | router | ✓ | Thể loại, số nhân vật (≤ 4 + người dẫn), bối cảnh |
| 1 | `story` | `script` (`mode: outline`) + refine | ✓ | Ghi `STORY.md`; rubric `story-outline` |
| 2 | `cast` | `cast` | ✓ | Đọc `STORY.md`; nhân vật: giọng, ảnh chuẩn, bộ biểu cảm; thử giọng |
| 3 | `design` | `design-system` | | |
| 4 | `script` | `script` (`mode: screenplay`) + refine | ✓ | Đọc `STORY.md`, `CAST.md`; mỗi line có `speaker` (CastId hoặc `narrator`), `direction`, `emotion` |
| 5 | `storyboard` | `storyboard` + refine | | Mỗi frame là một shot: cỡ cảnh (toàn/trung/cận), nhân vật, biểu cảm |
| 6 | `voice` | `voice` | | Nhiều giọng; biến thể cảm xúc theo `emotion` |
| 7 | `assets` | `assets` | | Nền theo scene; nhân vật từ bộ biểu cảm (`image.edit` với ảnh chuẩn làm tham chiếu) |
| 8 | `animatic` | `animatic` | ✓ | Khung tĩnh theo frame + audio (`RenderRecord.mode = animatic`) |
| 9 | `lipsync` | `lipsync` | | M5b; `lipsync.enabled = true`; chỉ shot trung/cận nhìn về máy quay |
| 10 | `frames` | `frame-build` | | Dùng cues lipsync |
| 11 | `captions` | `captions` | | Màu theo người nói |
| 12 | `music` | `music` | | |
| 13 | `finalize` | `finalize` | ✓ | |
| 14 | `meta`, `render` | | | |

## 3. Cast
- Nhân vật lưu ở cấp kênh `characters/<cast_id>/` (`cast.json`, ảnh chuẩn miệng đóng, `expressions/<key>.png` — mỗi ảnh đăng ký trong `assets/manifest.json` và `CastMember.expressions` trỏ `AssetId`), dùng lại giữa các video.
- Bộ biểu cảm mặc định: `neutral, happy, sad, angry, surprised, scared, thinking, talking` (8); sinh bằng `image.edit` từ ảnh chuẩn, người dùng duyệt từng ảnh.
- Giọng: clone từ file mẫu được phép; biến thể cảm xúc bằng ref audio riêng (`emotions`).

## 4. Lip-sync mức 1 (M5b)
- `lipsync.cues`: tính RMS theo cửa sổ = 1 video frame; ngưỡng `half`/`open` mặc định 0,15/0,35 RMS chuẩn hóa `[chờ S10]`; làm mượt: trạng thái giữ ≥ 2 video frame.
- Bộ miệng SVG của phong cách kênh: `mouths/<set>/<view>/{closed,half,open}.svg`, `view ∈ front | three_quarter`.
- Blueprint `character-talking` đặt lớp miệng (`kind: mouth`) tại `mouth_anchor`, đổi SVG theo cues bằng timeline GSAP.
- Shot toàn cảnh hoặc nhân vật quay đi: không lip-sync.

## 5. Gate thêm
Mỗi `speaker` trong `SCRIPT.md` có cast + voice; mỗi frame có nhân vật nói và `lipsync` bật thì có `mouth_anchor`.

## 6. Nghiệm thu
AC-M5-01; `samples/film-45s/` (2 nhân vật + người dẫn).
