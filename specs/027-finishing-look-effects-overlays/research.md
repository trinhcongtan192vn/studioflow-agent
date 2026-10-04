# Research — 027

## R1. Color grading của HyperFrames 0.8.115
- `hyperframes media-treatment --capabilities/--all`: preset (`vintage-wash`, `muted-editorial`, `night-lift`, `mono-fade`…), `adjust`, `details` (vignette, grain), `effects` (mỗi hiệu ứng có `apply` đề xuất + `renderLane` `single-pass`/`multipass`).
- `--grading <patch> --apply --dry-run --json` trả JSON đã chuẩn hóa (`after`), không ghi. `--apply` thật viết lại cả tài liệu (thêm `data-hf-id` mọi phần tử) → app tự ghi thuộc tính, chỉ dùng dry-run để kiểm + chuẩn hóa (FN-common 6: "dry-run trước").

## R2. Grade lúc render quá chậm → nướng look vào ảnh (Tan chọn)
Đo (RTX 5060 Ti): ảnh có `data-color-grading` buộc render sang chế độ chụp màn hình — 1 s video 20,4 s thay vì 2,5 s (~8×); `hyperframes snapshot`/`check` timeout điều hướng 10 s (cố định) → gate bước frames hỏng. Tan chọn **nướng look vào ảnh**: look (tĩnh) render một lần thành PNG; hiệu ứng media vẫn áp lúc render (chậm, giới hạn ngân sách). Mỗi lần render khởi tạo ~18 s → gom mọi ảnh cần nướng của video vào một lần render (mỗi ảnh một khung 0,1 s, `png-sequence`, nền trong suốt giữ alpha), cắt về kích thước gốc bằng FFmpeg. `<video>` không nướng (hiện chưa dùng).

## R3. Khối overlay
Khối registry HyperFrames (`lt-*`, `news-ticker`…) tải từ GitHub lúc `hyperframes add` (mạng) và chữ cứng trong HTML, không khai biến → app tự có khối trong gói phong cách `core-overlays` (mẫu `{{…}}`), mỗi khai báo thành một file riêng đã điền biến (không phụ thuộc `data-variable-values` theo instance).

## R4. Tool D4
- `media.treatment` `apply` (Tan chọn): ghi `sf-frame.effects` của các frame có layer dùng ảnh (qua `asset_id` trong storyboard hoặc ảnh do nút `asset:<el>` sinh); engine áp khi dựng frame.
- `grade.compare`: `hyperframes grade-compare --for <ảnh> --grades [...]` → PNG trong `.sf/preview/`.
- Danh mục cho agent: D4 không có tool liệt kê → executor bước đưa danh mục vào chỉ dẫn.

## R5. Ngân sách hiệu ứng nặng
"Tối đa 2 hiệu ứng nặng mỗi phút" hiểu là tổng số lần dùng hiệu ứng `multipass` trên các frame ≤ max(2, ⌊2 × phút⌋).

## R6. Bước sửa STORYBOARD.md đã duyệt
Theo D5 5.1 (ghi đè artifact đã duyệt → hỏi) và D6 3.1 (hash đổi → duyệt lại): bước look/effects/overlays sửa storyboard → người dùng xác nhận ghi đè và duyệt lại storyboard. Giữ đúng spec.

## R7. `skip_if.config`
D6 không nói tầng; ví dụ "`lipsync` bỏ qua khi `lipsync.enabled` = false" (khóa tầng kênh) → giải theo mọi tầng (trước chỉ đọc `config_overrides` của video). Fixture 007 chuyển `look` sang `skip_if: {config: look.id, equals: warm-archive}` vì `phase_before: M3` không còn bỏ qua.

## R8. Lỗi ẩn phát hiện khi làm
Sửa `blk.doc` của khối storyboard không được ghi (serializer chỉ theo `data`) → read-back look của 025 không lưu; sửa sang `blk.data`.
