---
name: short-film
description: Hướng dẫn từng bước của workflow StudioFlow "short-film" (phim ngắn nhiều nhân vật + người dẫn, comic/2D phẳng). Dùng khi engine giao bước cast, storyboard, assets, look, effects, overlays hoặc music của workflow này.
---

# Workflow short-film (phim ngắn nhiều nhân vật)

Engine giao cho bạn từng bước bằng chỉ dẫn "Thực hiện bước <id> của workflow short-film theo skill…". Chỉ làm đúng bước đó, ghi file bằng `artifact.write`, rồi gọi `workflow.step_complete` với `step_id` của bước và `outputs` là các file đã ghi.

Engine tự làm: story (dàn ý `STORY.md`, refine), design-system, script (kịch bản thoại theo `STORY.md` + `CAST.md`, refine), voice (giọng từng nhân vật, biến thể cảm xúc), animatic (khung tĩnh + lời để duyệt nhịp), lipsync (khi bật), frames, captions (màu theo người nói), finalize, meta, render.

Phong cách hình **cố định theo kênh** (comic hoặc 2D phẳng — xem look kênh `{{config:look.id}}` và `frame.md`).

## Bước `cast` → `CAST.md` (+ nhân vật cấp kênh)

Đọc `STORY.md` và `BRIEF.md`. Với mỗi nhân vật (tối đa 4) và người dẫn (nếu có):
1. **Dùng lại** nhân vật đã có của kênh: gọi `cast.list` (và `voice.list`). Nhân vật trùng (cùng tên/vai) thì giữ **đúng id `ca_…`** trong CAST.md (giọng, ảnh chuẩn, biểu cảm tự theo), bỏ qua bước 2–4 cho nhân vật đó.
2. **Giọng**: xem `voice.list` trước, ưu tiên giọng sẵn có phù hợp (đưa vào lựa chọn cho người dùng). Người dùng đã đính kèm file giọng mẫu được phép (`uploads/…`) → `voice.profile_create {name, ref_audio, language}` → `voice_id`. Không có file và không có giọng sẵn phù hợp → gợi ý 2–3 giọng cho nhân vật bằng `voice.design {name, gender, age, pitch, for: "ca_…"}` theo tuổi/giới tính/tính cách (xem skill `studioflow` mục Giọng đọc), để người dùng nghe và chọn; ghi `voice_id` đã chọn. Không tự lấy giọng người thật.
3. **Ảnh chuẩn**: `image.generate` chân dung toàn thân, nền trơn, miệng đóng, đúng phong cách kênh (`transparent: true`). Ghi `reference_images: [as_…]`.
4. **Bộ biểu cảm** (`neutral, happy, sad, angry, surprised, scared, thinking, talking`): `image.edit` từ ảnh chuẩn (`reference_asset_ids`), mỗi biểu cảm một ảnh; trình bày cho người dùng duyệt trong tóm tắt bước. Ghi `expressions: { happy: as_…, … }`.
5. Màu phụ đề riêng mỗi nhân vật (`caption_color`, tương phản tốt trên nền tối), người dẫn để trắng.

`CAST.md`:

````markdown
---
schema_version: 1
video_id: <vd_…>
---
# Nhân vật

```sf-cast
- { name: "Mai", role: character, voice_id: vo_…, reference_images: [as_…], expressions: { neutral: as_…, happy: as_… }, caption_color: "#ffd54a" }
- { name: "Người dẫn", role: narrator, voice_id: vo_…, reference_images: [] }
```

<mô tả ngắn từng nhân vật: tính cách, cách nói>
````

Không ghi `id:` cho nhân vật mới (app gán `ca_…`). Kết thúc: `workflow.step_complete {step_id: "cast", outputs: ["CAST.md"]}`. Người dẫn dùng `speaker: narrator` trong kịch bản (giọng `voice.id` của kênh nếu không khai trong CAST).

**Biến thể cảm xúc giọng** (tùy chọn): nếu người dùng có ref audio cho cảm xúc của nhân vật, thêm `emotions: { sad: "uploads/…wav" }` — line có `emotion: sad` sẽ đọc bằng giọng đó.

## Bước `storyboard` → `STORYBOARD.md` (có refine)

Mỗi frame là **một shot**: ghi trong `intent` cỡ cảnh (`toàn` / `trung` / `cận`), nhân vật trong khung, biểu cảm, hướng nhìn. Layers: `background` (bối cảnh theo scene), `image` cho nhân vật với `asset_id` là ảnh biểu cảm phù hợp từ `CAST.md` (`expressions`), `text` hiếm khi cần. Scene đổi khi đổi bối cảnh/thời gian. Mỗi line thuộc đúng một frame; một shot 1–3 line (2–8 giây). Shot trung/cận có nhân vật đang nói nhìn về máy quay là shot hợp lip-sync (khi bật).

**Khẩu hình (khi `lipsync.enabled` bật cho video/kênh):** với shot trung/cận mà một nhân vật nói và nhìn về máy quay, thêm layer `- { kind: mouth, notes: "miệng <tên>" }`. Ghi `STORYBOARD.md` một lần để app gán ID, đọc lại lấy ID của layer miệng, rồi thêm vào khối `sf-frame` đó `lipsync: { cast_id: ca_…, mouth_anchor: el_… }` (nhân vật đang nói trong shot) và ghi lại. Shot toàn cảnh hoặc nhân vật quay đi: không khai `lipsync`. App tự tính khẩu hình từ lời thoại và chèn hình miệng theo bộ miệng của nhân vật (`mouth_set`, mặc định `flat`). Ghi `STORYBOARD.md`, rồi `workflow.step_complete {step_id: "storyboard", outputs: ["STORYBOARD.md"]}`.

## Bước `assets` (khi engine giao)

Nền mỗi scene: `asset_request: { source: generate, prompt: "<bối cảnh, phong cách kênh, không có người>", aspect: "16:9" }`. Nhân vật: luôn dùng ảnh biểu cảm có sẵn trong `CAST.md` (thiếu biểu cảm → `image.edit` từ ảnh chuẩn rồi cập nhật `CAST.md`). Ghi file (giữ mọi `id`) rồi `workflow.step_complete {step_id: "assets", outputs: [<file đã ghi>]}`.

## Bước `music`

Nhạc theo không khí từng scene (`music.find`, query tiếng Anh). Không có kết quả → `music: none` cho scene đó, vẫn ghi `STORYBOARD.md` và `workflow.step_complete {step_id: "music", outputs: ["STORYBOARD.md"]}`.
## Bước `finish` (M3, 062)

Engine giao **một phiên** cho cả ba phần hoàn thiện hình, kèm danh mục look, hiệu ứng, khối overlay, ngân sách hiệu ứng nặng và hiện trạng từng frame. Làm lần lượt theo ba mục dưới — look (mục "Bước `look`"), hiệu ứng (mục "Bước `effects`"), overlay (mục "Bước `overlays`"); phần nào không cần thì bỏ qua. Ghi `STORYBOARD.md` (giữ mọi `id`) rồi gọi **một lần** `workflow.step_complete {step_id: "finish", outputs: ["STORYBOARD.md"]}` (bỏ qua lời dặn `step_complete` riêng trong từng mục).

## Bước `look` (M3)

Chỉ dẫn của engine có danh mục look (gói phong cách + biến thể) và look hiện tại của từng frame. Look kênh là `{{config:look.id}}`. Mặc định giữ look kênh; chỉ đặt `look` cho scene khi không khí khác rõ (đêm, hồi tưởng, tư liệu cũ): ghi `look: <biến thể>` (ví dụ `night`) hoặc `look: <gói khác>` vào `sf-scene`; ngoại lệ một frame thì `config: { look.id: … }` trong `sf-frame`. Muốn so sánh trước: `grade.compare {asset_ids: [ảnh tiêu biểu], looks: [...]}` rồi xem `contact_sheet`. Look được nướng vào ảnh khi dựng frame (chữ/hình HTML không đổi màu). Không có gì cần đổi → không ghi file. Xong: `workflow.step_complete {step_id: "look", outputs: ["STORYBOARD.md"]}`.

## Bước `effects` (M3)

Hiệu ứng media dùng tiết chế, phục vụ nội dung (hồi tưởng → `grain`, tư liệu cũ → `filmArtifacts`, nhấn mạnh → `bloom`). Hiệu ứng `[nặng]` làm render chậm: tôn trọng ngân sách trong chỉ dẫn (2 mỗi phút video). Với mỗi ảnh cần hiệu ứng: `media.treatment {asset_id, effect, mode: "dry_run"}` → đọc kết quả (`within_budget`, frame bị ảnh hưởng) → nếu ổn thì `mode: "apply"` (app ghi `sf-frame.effects`, người dùng được hỏi vì storyboard đã duyệt). Mức tùy chọn: `grain:0.3`. Không cần hiệu ứng → không làm gì. Xong: `workflow.step_complete {step_id: "effects", outputs: ["STORYBOARD.md"]}`.

## Bước `overlays` (M3)

Đề xuất overlay theo quy tắc kênh `{{config:overlay.rules}}` (ví dụ lower third khi nhân vật/địa danh xuất hiện lần đầu, nhãn địa điểm khi đổi bối cảnh). Ghi vào `sf-frame`: `overlays: [{ block: lower-third, vars: { title: "…", subtitle: "…" } }]` — chỉ dùng khối trong danh mục, đủ biến bắt buộc (dấu `*`), chữ ngắn (≤ 40 ký tự). Thẻ mô phỏng nền tảng thật (bình luận, bài đăng mạng xã hội) chỉ dùng với nội dung có thật. Mỗi frame tối đa một overlay. Ghi bằng `artifact.write` (giữ mọi `id`), rồi `workflow.step_complete {step_id: "overlays", outputs: ["STORYBOARD.md"]}`.
