# 092 — Đổi tùy chọn Nâng cao: gợi ý chạy lại từ đúng bước

## Bối cảnh

Tan: video đã chạy hết luồng (xong Render phát hành), đổi tùy chọn Nâng cao (085) thì làm sao chạy lại để áp dụng?
Cần nút CTA cho biết chạy lại từ bước nào, vì mỗi tùy chọn ảnh hưởng bước khác nhau.

Hiện trạng: đổi tùy chọn chỉ ghi cấu hình; không có gợi ý. Ngoài ra tắt `advanced.music` trên video đã có nhạc thì
bước `music` bị bỏ qua nhưng `index.html` vẫn dựng nhạc từ `track_id` đã gắn trong storyboard → video vẫn có nhạc.

## Yêu cầu

- FR-WF-92-01: `VideoStateSummary.steps[]` có thêm `uses` (loại bước trong thư viện D6) để giao diện biết bước nào
  chịu ảnh hưởng của tùy chọn nào, không phụ thuộc ID bước của từng workflow.
- FR-WF-92-02: `advanced.music` = false → dựng `index.html` không có nhạc nền, kể cả khi storyboard còn `track_id`
  cũ (bật lại → nhạc cũ quay lại, không chọn lại).
- FR-UI-92-03: đổi một tùy chọn Nâng cao ở tab Tiến độ của video → thẻ gợi ý ngay dưới bảng Nâng cao:
  - bước chịu ảnh hưởng (theo `uses`): `advanced.refine` → `script`, `storyboard`, `publish-meta`;
    `advanced.reasoning` → `script`, `storyboard`, `publish-meta`; `advanced.music` → `music`;
    `advanced.custom_frames` → `frame-build`.
  - Bước sớm nhất chịu ảnh hưởng đã chạy (không còn `pending`) → nút chính **↻ Chạy lại từ "<bước>"** (quay lại bước
    đó; các bước sau cần chạy lại, kể cả điểm duyệt), kèm câu nói rõ các bước sau phải làm lại. Với refine/reasoning có
    thêm nút phụ rẻ hơn **Chỉ làm lại "Tiêu đề, mô tả"** (bước `publish-meta`) khi bước đó đã chạy.
  - Chưa bước nào chịu ảnh hưởng chạy → "Sẽ áp dụng khi chạy tới bước …", không nút.
  - Trả về giá trị cũ → bỏ gợi ý.
- Đổi ở Cài đặt kênh: ghi chú dưới bảng Nâng cao của kênh "Áp dụng cho video mới và các bước chưa chạy; video đã làm:
  mở video → Tiến độ → Nâng cao để xem nên chạy lại từ đâu".

## Test

- `apps/desktop/tests/unit/advanced-format.test.ts`: `rerunHint` cho từng khóa (đã chạy / chưa chạy / trả về cũ /
  nút phụ publish-meta).
- `packages/core`: summary có `uses`; `advanced.music` false → index không có `el-music` dù storyboard có `track_id`.
