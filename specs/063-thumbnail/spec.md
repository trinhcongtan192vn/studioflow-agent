# 063 — Bước Thumbnail

## Vấn đề
Chưa workflow nào tạo hình đại diện; publisher YouTube (053) chỉ tải lên nếu có `thumbnail.jpg|png`. Thumbnail quyết định CTR.

## Yêu cầu
- FR-IM-63-01: Bước thư viện `thumbnail` (engine, D6) sau "Tiêu đề & mô tả", trước render, trong narrated-explainer / story-documentary / essay-audiobook / short-film (không có trong shorts: API YouTube không đặt hình đại diện cho Shorts; video dọc → bỏ qua).
- FR-IM-63-02: Cách làm: LLM phụ (`text.aux`) viết câu móc ≤ 5 từ + mô tả ảnh nền (không chữ); `image.generate` sinh nền 1280×720 theo look kênh; HyperFrames chụp một khung ghép chữ to (font `font.family`, màu nhấn/nền từ `frame.md`, từ cuối tô màu nhấn); ffmpeg → `thumbnail.jpg`. Lỗi LLM → câu móc rút từ tiêu đề; lỗi sinh ảnh → ảnh lớn nhất trong `public/` của video; không có → nền màu kênh.
- FR-IM-63-03: Kiểm `thumbnail_valid`: JPEG 16:9, ≤ 2 MB (giới hạn YouTube); video dọc qua.
- Chat: nút "Xem thumbnail".

## AC
- `thumbnail.test.ts`: kích thước JPEG, câu móc, trang ghép, kiểm.
- E2E narrated-explainer: `thumbnail.jpg` 1280×720 được tạo (không LLM/ảnh sinh → nền màu kênh).
