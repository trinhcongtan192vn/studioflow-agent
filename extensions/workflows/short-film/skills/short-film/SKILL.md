---
name: short-film
description: Workflow StudioFlow "short-film" (phim ngắn nhiều nhân vật + người dẫn, comic/2D phẳng). Dùng khi engine giao bước cast, hoặc khi người dùng hỏi về luồng dựng / nhờ chỉnh hình, chữ, ảnh, nhạc của một shot.
---

# Workflow short-film (phim ngắn nhiều nhân vật)

Engine giao cho bạn **một** bước: `cast`. Chỉ làm đúng bước đó, ghi file bằng `artifact.write`, rồi gọi `workflow.step_complete` với `step_id: "cast"` và `outputs` là các file đã ghi.

Phong cách hình **cố định theo kênh** (design system kênh và `frame.md`). **Bước này không sinh ảnh**: ảnh nhân vật được sinh sau khi Đạo diễn hình chốt từng cảnh — bước Ảnh vẽ ảnh chuẩn từ `look` rồi đúng các tư thế/hành động đạo diễn cần (cùng một nhân vật nhờ ảnh chuẩn làm tham chiếu). Khẩu hình (khi bật) đặt lớp miệng trên đầu nhân vật.

## Bước `cast` → `CAST.md` (+ nhân vật cấp kênh)

Đọc `STORY.md` và `BRIEF.md`. Với mỗi nhân vật (tối đa 4) và người dẫn (nếu có):
1. **Dùng lại** nhân vật đã có của kênh: gọi `cast.list` (và `voice.list`). Nhân vật trùng (cùng tên/vai) thì giữ **đúng id `ca_…`** trong CAST.md (giọng, ngoại hình, ảnh đã có tự theo), bỏ qua bước 2–3 cho nhân vật đó.
2. **Giọng**: xem `voice.list` trước, ưu tiên giọng sẵn có phù hợp (đưa vào lựa chọn cho người dùng). Người dùng đã đính kèm file giọng mẫu được phép (`uploads/…`) → `voice.profile_create {name, ref_audio, language}` → `voice_id`. Không có file và không có giọng sẵn phù hợp → gợi ý 2–3 giọng cho nhân vật bằng `voice.design {name, gender, age, pitch, for: "ca_…"}` theo tuổi/giới tính/tính cách (xem skill `studioflow` mục Giọng đọc), để người dùng nghe và chọn; ghi `voice_id` đã chọn. Không tự lấy giọng người thật.
3. **Ngoại hình** (`look`, tiếng Anh, một câu cố định): tuổi, dáng người, khuôn mặt, tóc, trang phục kèm màu, phụ kiện nhận diện — đủ cụ thể để mọi tư thế vẽ ra là cùng một người. Không gọi `image.generate`/`image.edit` ở bước này.
4. Màu phụ đề riêng mỗi nhân vật (`caption_color`, tương phản tốt trên nền tối), người dẫn để trắng.

`CAST.md`:

````markdown
---
schema_version: 1
video_id: <vd_…>
---
# Nhân vật

```sf-cast
- { name: "Mai", role: character, voice_id: vo_…, reference_images: [], look: "9-year-old girl, two short braids with yellow ribbons, round face with freckles, yellow T-shirt, denim overalls, red sneakers", caption_color: "#ffd54a" }
- { name: "Người dẫn", role: narrator, voice_id: vo_…, reference_images: [] }
```

<mô tả ngắn từng nhân vật: tính cách, cách nói>
````

Không ghi `id:` cho nhân vật mới (app gán `ca_…`). Kết thúc: `workflow.step_complete {step_id: "cast", outputs: ["CAST.md"]}`. Người dẫn dùng `speaker: narrator` trong kịch bản (giọng `voice.id` của kênh nếu không khai trong CAST).

**Biến thể cảm xúc giọng** (tùy chọn): nếu người dùng có ref audio cho cảm xúc của nhân vật, thêm `emotions: { sad: "uploads/…wav" }` — line có `emotion: sad` sẽ đọc bằng giọng đó.

## Luồng dựng (v2 — engine tự làm, không giao bạn từng bước)

story (duyệt) → **cast** (bạn, duyệt) → design → script thoại (duyệt) → voice → **direct** → **media** → lipsync → **compose** (duyệt bản xem trước) → meta → thumbnail → render → publish

Bạn không viết storyboard, không dựng frame, không chọn ảnh/nhạc từng cảnh: bước **Đạo diễn hình** (`direct`) do Opus lên danh sách cảnh một lượt cho cả video; **Ảnh và nhạc** (`media`) sinh ảnh bằng bộ sinh ảnh cục bộ + chọn nhạc; **Dựng hình** (`compose`) dựng frame từ bộ layout bằng code, lắp phụ đề, kiểm và tự sửa, rồi làm bản nháp để người dùng duyệt.

## Khi người dùng muốn chỉnh hình qua chat

- **Đổi ảnh / chữ / layout / chuyển động một cảnh:** đọc `STORYBOARD.md`, sửa đúng khối `sf-frame` của cảnh đó bằng `artifact.edit` (giữ mọi `id`):
  - layout: `layout: <id>` — image-title, image-caption, image-split, image-zoom-detail, split-text, stat-pop, big-text, list, quote, chart-bar;
  - chuyển động: `motion: <id>` — ken-burns-in, ken-burns-out, pan-left, pan-up, pop, slide-up;
  - chữ: `text` của layer `kind: text` (ngắn, ≤ 6 từ, không chép câu thoại);
  - ảnh: `asset_request: { source: generate, prompt: "<mô tả tiếng Anh>", aspect: "16:9" }` trên layer `background` (hoặc `asset_id: as_…` để dùng ảnh thư viện kênh — tìm bằng `asset.search`).
  Rồi chạy lại từ **Ảnh và nhạc** (ảnh mới) hoặc **Dựng hình** (chỉ chữ/layout) bằng `workflow.rewind`.
- **Làm lại toàn bộ hình:** `workflow.rewind` về bước `direct`.
- **Dời/chỉnh kích thước phần tử, sửa tự do:** mở Studio (tab Xem trước → Chỉnh), lưu nguyên frame.
- **Nhạc:** đổi `music: { query: "…" }` (hoặc `track_id`) trong `sf-scene` rồi chạy lại **Ảnh và nhạc**.
