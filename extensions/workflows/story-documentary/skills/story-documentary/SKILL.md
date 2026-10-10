---
name: story-documentary
description: Workflow StudioFlow "story-documentary" (phim tài liệu kể chuyện theo scene). Dùng khi người dùng hỏi về luồng dựng hoặc nhờ chỉnh hình, chữ, ảnh, nhạc của một cảnh.
---

# Workflow story-documentary (phim tài liệu)

Đặc thù: ảnh điện ảnh chân thực theo scene, chữ tối thiểu (năm, địa danh), chuyển động chậm; nhạc theo từng scene; mô tả có mốc chương.

## Luồng dựng (v2 — engine tự làm, không giao bạn từng bước)

design → script (duyệt) → voice → **direct** → **media** → **compose** (duyệt bản xem trước) → meta → thumbnail → render → publish

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
