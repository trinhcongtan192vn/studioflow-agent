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

> 085: engine tự chạy bước này (không giao agent) khi tính năng nâng cao **Nhạc nền** (`advanced.music`) bật; tắt thì bỏ qua. Phần dưới chỉ dùng khi người dùng nhờ chọn/đổi nhạc qua chat. Ở bước storyboard vẫn ghi `music: { query: … }` (mô tả nhạc) cho mỗi scene.

Như workflow narrated-explainer, nhưng **nhạc theo scene**: mỗi scene `music.find` với `query` của scene (mô tả tiếng Anh). Có kết quả → `music: { track_id: mt_…, volume_db: -20 }`. Không có kết quả (`E_MUSIC_NOT_FOUND`, kể cả kho trống) là bình thường: thử lại một lần ít bộ lọc hơn; vẫn không có → đặt `music: none` cho scene đó, vẫn ghi `STORYBOARD.md` và gọi `workflow.step_complete {step_id: "music", outputs: ["STORYBOARD.md"]}` — không dừng chờ người dùng, không bịa `track_id`.

## Bước `finish` (M3, 062)

Engine giao **một phiên** cho cả ba phần hoàn thiện hình, kèm danh mục look, hiệu ứng, khối overlay, ngân sách hiệu ứng nặng và hiện trạng từng frame. Làm lần lượt theo ba mục dưới — look (mục "Bước `look`"), hiệu ứng (mục "Bước `effects`"), overlay (mục "Bước `overlays`"); phần nào không cần thì bỏ qua. Ghi `STORYBOARD.md` (giữ mọi `id`) rồi gọi **một lần** `workflow.step_complete {step_id: "finish", outputs: ["STORYBOARD.md"]}` (bỏ qua lời dặn `step_complete` riêng trong từng mục).

## Bước `look` (M3)

Chỉ dẫn của engine có danh mục look (gói phong cách + biến thể) và look hiện tại của từng frame. Look kênh là `{{config:look.id}}`. Mặc định giữ look kênh; chỉ đặt `look` cho scene khi không khí khác rõ (đêm, hồi tưởng, tư liệu cũ): ghi `look: <biến thể>` (ví dụ `night`) hoặc `look: <gói khác>` vào `sf-scene`; ngoại lệ một frame thì `config: { look.id: … }` trong `sf-frame`. Muốn so sánh trước: `grade.compare {asset_ids: [ảnh tiêu biểu], looks: [...]}` rồi xem `contact_sheet`. Look được nướng vào ảnh khi dựng frame (chữ/hình HTML không đổi màu). Không có gì cần đổi → không ghi file. Xong: `workflow.step_complete {step_id: "look", outputs: ["STORYBOARD.md"]}`.

## Bước `effects` (M3)

Hiệu ứng media dùng tiết chế, phục vụ nội dung (hồi tưởng → `grain`, tư liệu cũ → `filmArtifacts`, nhấn mạnh → `bloom`). Hiệu ứng `[nặng]` làm render chậm: tôn trọng ngân sách trong chỉ dẫn (2 mỗi phút video). Với mỗi ảnh cần hiệu ứng: `media.treatment {asset_id, effect, mode: "dry_run"}` → đọc kết quả (`within_budget`, frame bị ảnh hưởng) → nếu ổn thì `mode: "apply"` (app ghi `sf-frame.effects`, người dùng được hỏi vì storyboard đã duyệt). Mức tùy chọn: `grain:0.3`. Không cần hiệu ứng → không làm gì. Xong: `workflow.step_complete {step_id: "effects", outputs: ["STORYBOARD.md"]}`.

## Bước `overlays` (M3)

Đề xuất overlay theo quy tắc kênh `{{config:overlay.rules}}` (ví dụ lower third khi nhân vật/địa danh xuất hiện lần đầu, nhãn địa điểm khi đổi bối cảnh). Ghi vào `sf-frame`: `overlays: [{ block: lower-third, vars: { title: "…", subtitle: "…" } }]` — chỉ dùng khối trong danh mục, đủ biến bắt buộc (dấu `*`), chữ ngắn (≤ 40 ký tự). Thẻ mô phỏng nền tảng thật (bình luận, bài đăng mạng xã hội) chỉ dùng với nội dung có thật. Mỗi frame tối đa một overlay. Ghi bằng `artifact.write` (giữ mọi `id`), rồi `workflow.step_complete {step_id: "overlays", outputs: ["STORYBOARD.md"]}`.
