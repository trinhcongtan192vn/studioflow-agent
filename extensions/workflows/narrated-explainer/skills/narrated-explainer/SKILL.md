---
name: narrated-explainer
description: Hướng dẫn từng bước của workflow StudioFlow "narrated-explainer" (video thuyết minh một người dẫn). Dùng khi engine giao bước storyboard, assets hoặc music của workflow này.
---

# Workflow narrated-explainer (video thuyết minh)

Engine giao cho bạn từng bước bằng chỉ dẫn "Thực hiện bước <id> của workflow narrated-explainer theo skill…". Chỉ làm đúng bước đó, ghi file bằng `artifact.write`, rồi gọi `workflow.step_complete` với `step_id` của bước và `outputs` là các file đã ghi. Không tự chạy bước khác.

Các bước engine tự làm (bạn không làm): design-system, script (refine-loop), voice (TTS + ASR), frames (phiên frame riêng), captions, finalize, meta, render.

## Bước `storyboard` → `STORYBOARD.md`

Đọc `BRIEF.md`, `SCRIPT.md` (line có ID `ln_…`, beat `bt_…`) và `frame.md`. Viết `STORYBOARD.md` đúng định dạng:

````markdown
---
schema_version: 1
video_id: <vd_… của video>
status: draft
---
## Scene 1 — <tên scene>
```sf-scene
title: <tên scene>
mood: <tâm trạng>
music: { query: "<mô tả nhạc nền, tiếng Việt>" }
```

### Frame 1
```sf-frame
beat_ids: [bt_…]
line_ids: [ln_…, ln_…]
intent: "<ý đồ hình ảnh/chuyển động, cụ thể>"
layers:
  - { kind: background, notes: "<nền>" }
  - { kind: text, text: "<chữ ngắn trên hình>" }
  - { kind: shape, notes: "<hình vẽ bằng code>" }
transition_in: { type: crossfade, duration_ms: 500 }
```
````

Quy tắc:
- **Mỗi line của SCRIPT.md thuộc đúng một frame** (gate `coverage`), theo thứ tự kịch bản. Một frame gồm 1–3 line liên tiếp (8–20 giây); beat dài tách nhiều frame.
- Mặc định **một scene**; tối đa 3 scene khi nội dung đổi hẳn chủ đề.
- **Không ghi `id:`** cho scene/frame/layer mới — app tự gán ID khi ghi.
- `layers` mô tả các phần tử chính (2–4 layer): `background`, `text` (chữ ngắn kiểu motion graphics, không chép câu thoại), `shape`/`chart` (vẽ bằng code), `image` (chỉ khi có asset trong thư viện kênh: `asset_id: as_…`).
- `transition_in` của frame đầu bỏ trống; frame sau: `crossfade` (cùng scene, 400–600 ms) hoặc `blur-crossfade`/`push-slide`/`zoom-through` khi đổi ý lớn; tối đa 3 loại transition mỗi video.
- `intent` viết như chỉ dẫn cho người dựng hình: thứ gì xuất hiện, theo nhịp câu nào, chuyển động ra sao.
- Ghi bằng `artifact.write` (`path: STORYBOARD.md`), đọc lại kết quả (ID đã gán), rồi `workflow.step_complete {step_id: "storyboard", outputs: ["STORYBOARD.md"]}`.

## Bước `assets` (M1: thư viện → code → người dùng)

Với mỗi layer cần ảnh thật (`image`): tìm trong thư viện kênh bằng `asset.search`; có → ghi `asset_id` vào layer (sửa `STORYBOARD.md` bằng `artifact.write`, giữ nguyên mọi `id`). Không có → đổi layer thành hình vẽ bằng code (`shape`/`chart`, `notes` mô tả) hoặc nhờ người dùng đính kèm ảnh rồi `asset.import`. Explainer thuần đồ họa: thường không cần ảnh — báo xong ngay. Kết thúc: `workflow.step_complete {step_id: "assets", outputs: []}`.

## Bước `music`

> 085: engine tự chạy bước này (không giao agent) khi tính năng nâng cao **Nhạc nền** (`advanced.music`) bật; tắt thì bỏ qua. Phần dưới chỉ dùng khi người dùng nhờ chọn/đổi nhạc qua chat. Ở bước storyboard vẫn ghi `music: { query: … }` (mô tả nhạc) cho mỗi scene.

Với mỗi scene có `music.query`: gọi `music.find` (query từ scene, `min_duration_ms` ≈ thời lượng video nếu biết). Có kết quả → đặt `music: { track_id: mt_… }` trong khối `sf-scene` (mức nhạc theo cấu hình kênh) (giữ `query`). Không có kết quả (`E_MUSIC_NOT_FOUND`, kể cả khi kho nhạc trống) là **trường hợp bình thường**: thử lại một lần với ít bộ lọc hơn; vẫn không có → **bắt buộc** đặt `music: none` cho scene đó, vẫn ghi `STORYBOARD.md` và gọi `workflow.step_complete` — không dừng chờ người dùng, không bịa `track_id`; trong câu trả lời nhắc người dùng có thể nạp nhạc rồi quay lại bước này. Một bài cho cả video trừ khi storyboard có nhiều scene. Ghi `STORYBOARD.md` bằng `artifact.write`, rồi `workflow.step_complete {step_id: "music", outputs: ["STORYBOARD.md"]}`.

## Bước `finish` (M3, 062)

Engine giao **một phiên** cho cả ba phần hoàn thiện hình, kèm danh mục look, hiệu ứng, khối overlay, ngân sách hiệu ứng nặng và hiện trạng từng frame. Làm lần lượt theo ba mục dưới — look (mục "Bước `look`"), hiệu ứng (mục "Bước `effects`"), overlay (mục "Bước `overlays`"); phần nào không cần thì bỏ qua. Ghi `STORYBOARD.md` (giữ mọi `id`) rồi gọi **một lần** `workflow.step_complete {step_id: "finish", outputs: ["STORYBOARD.md"]}` (bỏ qua lời dặn `step_complete` riêng trong từng mục).

## Bước `look` (M3)

Chỉ dẫn của engine có danh mục look (gói phong cách + biến thể) và look hiện tại của từng frame. Look kênh là `{{config:look.id}}`. Mặc định giữ look kênh; chỉ đặt `look` cho scene khi không khí khác rõ (đêm, hồi tưởng, tư liệu cũ): ghi `look: <biến thể>` (ví dụ `night`) hoặc `look: <gói khác>` vào `sf-scene`; ngoại lệ một frame thì `config: { look.id: … }` trong `sf-frame`. Muốn so sánh trước: `grade.compare {asset_ids: [ảnh tiêu biểu], looks: [...]}` rồi xem `contact_sheet`. Look được nướng vào ảnh khi dựng frame (chữ/hình HTML không đổi màu). Không có gì cần đổi → không ghi file. Xong: `workflow.step_complete {step_id: "look", outputs: ["STORYBOARD.md"]}`.

## Bước `effects` (M3)

Hiệu ứng media dùng tiết chế, phục vụ nội dung (hồi tưởng → `grain`, tư liệu cũ → `filmArtifacts`, nhấn mạnh → `bloom`). Hiệu ứng `[nặng]` làm render chậm: tôn trọng ngân sách trong chỉ dẫn (2 mỗi phút video). Với mỗi ảnh cần hiệu ứng: `media.treatment {asset_id, effect, mode: "dry_run"}` → đọc kết quả (`within_budget`, frame bị ảnh hưởng) → nếu ổn thì `mode: "apply"` (app ghi `sf-frame.effects`, người dùng được hỏi vì storyboard đã duyệt). Mức tùy chọn: `grain:0.3`. Không cần hiệu ứng → không làm gì. Xong: `workflow.step_complete {step_id: "effects", outputs: ["STORYBOARD.md"]}`.

## Bước `overlays` (M3)

Đề xuất overlay theo quy tắc kênh `{{config:overlay.rules}}` (ví dụ lower third khi nhân vật/địa danh xuất hiện lần đầu, nhãn địa điểm khi đổi bối cảnh). Ghi vào `sf-frame`: `overlays: [{ block: lower-third, vars: { title: "…", subtitle: "…" } }]` — chỉ dùng khối trong danh mục, đủ biến bắt buộc (dấu `*`), chữ ngắn (≤ 40 ký tự). Thẻ mô phỏng nền tảng thật (bình luận, bài đăng mạng xã hội) chỉ dùng với nội dung có thật. Mỗi frame tối đa một overlay. Ghi bằng `artifact.write` (giữ mọi `id`), rồi `workflow.step_complete {step_id: "overlays", outputs: ["STORYBOARD.md"]}`.
