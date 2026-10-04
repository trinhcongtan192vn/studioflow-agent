---
name: story-documentary
description: Hướng dẫn từng bước của workflow StudioFlow "story-documentary" (phim tài liệu kể chuyện nhiều scene, ảnh sinh). Dùng khi engine giao bước storyboard, assets hoặc music của workflow này.
---

# Workflow story-documentary (phim tài liệu kể chuyện)

Engine giao cho bạn từng bước bằng chỉ dẫn "Thực hiện bước <id> của workflow story-documentary theo skill…". Chỉ làm đúng bước đó, ghi file bằng `artifact.write`, rồi gọi `workflow.step_complete` với `step_id` của bước và `outputs` là các file đã ghi. Không tự chạy bước khác.

Các bước engine tự làm (bạn không làm): design-system, script (refine-loop), voice (TTS + ASR), assets (sinh ảnh từ `asset_request`), frames (phiên frame riêng), captions, finalize, meta, render.

## Bước `storyboard` → `STORYBOARD.md` (có refine-loop)

Bước này chạy nhiều vòng: mỗi vòng bạn là một phiên mới; từ vòng 2 chỉ dẫn kèm danh sách vấn đề của người chấm — sửa đúng các vấn đề đó trên `STORYBOARD.md` hiện có, **giữ nguyên mọi `id`**.

Đọc `BRIEF.md`, `SCRIPT.md` (line `ln_…`, beat `bt_…`), `frame.md`. Viết `STORYBOARD.md`:

````markdown
---
schema_version: 1
video_id: <vd_…>
status: draft
---
## Scene 1 — <địa điểm, thời điểm>
```sf-scene
title: <tên scene>
setting: <không gian: nơi chốn, thời đại>
time_of_day: <bình minh | trưa | hoàng hôn | đêm>
mood: <tâm trạng>
look: <id look kênh, bỏ trống để dùng look mặc định>
music: { query: "<mô tả nhạc bằng tiếng Anh: tâm trạng, nhịp, nhạc cụ>" }
```

### Frame 1
```sf-frame
beat_ids: [bt_…]
line_ids: [ln_…, ln_…]
intent: "<ý đồ hình ảnh/chuyển động cụ thể theo nhịp câu>"
layers:
  - { kind: background, asset_request: { source: generate, prompt: "<mô tả ảnh nền bằng tiếng Anh>", aspect: "16:9" } }
  - { kind: object, asset_request: { source: generate, prompt: "<vật thể đơn, tiếng Anh>", transparent: true } }
  - { kind: text, text: "<mốc năm, địa danh ngắn>" }
transition_in: { type: crossfade, duration_ms: 600 }
```
````

Quy tắc:
- **Scene là đơn vị bắt buộc**: đổi không gian/thời gian → scene mới; mỗi scene có `setting`, `time_of_day`, `mood` (và `look` nếu khác mặc định). Ảnh trong cùng scene dùng chung seed nên nhất quán.
- **Mỗi line của SCRIPT.md thuộc đúng một frame** (gate `coverage`), theo thứ tự. Frame 1–3 line (8–25 giây).
- **Mật độ ảnh sinh**: khoảng một ảnh mới mỗi 15–25 giây. Frame khác dùng lại ảnh đã có (cùng `asset_request` → cùng ảnh) với chuyển động khác (pan, zoom, che chữ), hoặc đồ họa code: bản đồ (`shape`/`chart`), dòng thời gian, trích dẫn.
- `asset_request.prompt` viết **bằng tiếng Anh**, cụ thể: chủ thể, bối cảnh thời đại, ánh sáng, phong cách ("painterly historical illustration", "archival photo style"…). Không yêu cầu chữ trong ảnh (chữ để layer `text`).
- Nhân vật lịch sử xuất hiện nhiều lần: frame đầu sinh chân dung; frame sau thêm `reference_asset_ids: [<asset của chân dung>]` khi đã có id (sau bước assets) — ở storyboard đầu tiên có thể chỉ mô tả nhất quán trong prompt.
- Vật thể dựng lớp (vũ khí, con dấu, thuyền…) dùng `transparent: true` (ảnh nền trong suốt 1024²).
- **Không ghi `id:`** cho scene/frame/layer mới — app tự gán.
- `transition_in`: frame đầu bỏ trống; cùng scene `crossfade` 500–700 ms; đổi scene `blur-crossfade` hoặc `zoom-through`.
- Ghi bằng `artifact.write` (`path: STORYBOARD.md`), đọc lại (ID đã gán), rồi `workflow.step_complete {step_id: "storyboard", outputs: ["STORYBOARD.md"]}`.

## Bước `assets` (khi engine giao)

Engine đã sinh ảnh cho mọi `asset_request: { source: generate }`. Bạn chỉ được giao khi còn layer `source: library` hoặc `source: user` chưa có `asset_id`: tìm trong thư viện kênh (`asset.search`); có → ghi `asset_id` vào layer (sửa `STORYBOARD.md`, giữ mọi `id`); không có → đổi layer sang `asset_request: { source: generate, prompt: "…" }` hoặc vẽ bằng code (`kind: shape`, `notes`). Kết thúc: `workflow.step_complete {step_id: "assets", outputs: ["STORYBOARD.md"]}`.

## Bước `music`

Như workflow narrated-explainer, nhưng **nhạc theo scene**: mỗi scene `music.find` với `query` của scene (mô tả tiếng Anh). Có kết quả → `music: { track_id: mt_…, volume_db: -20 }`. Không có kết quả (`E_MUSIC_NOT_FOUND`, kể cả kho trống) là bình thường: thử lại một lần ít bộ lọc hơn; vẫn không có → đặt `music: none` cho scene đó, vẫn ghi `STORYBOARD.md` và gọi `workflow.step_complete {step_id: "music", outputs: ["STORYBOARD.md"]}` — không dừng chờ người dùng, không bịa `track_id`.
