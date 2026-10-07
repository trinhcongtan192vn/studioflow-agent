# 058 — autoAlpha trên phần tử clip chặn render phát hành; nút "Mở thư mục" sau khi render

## Vấn đề
Render phát hành của vd_jegcn38v lỗi `hf_check`: `gsap_animates_clip_element` — frame agent animate `autoAlpha` trên phần tử `class="clip"` (HyperFrames tự quản lý hiển thị clip; `autoAlpha` ghi cả `visibility`). Lỗi đã gặp trước đó; frame agent vẫn viết lại kiểu này → Autopilot chạy không người sẽ kẹt ở render.
Tan (2026-10-07): thêm nút mở thư mục chứa video sau khi render xong.

## Yêu cầu
- FR-CP-58-01: Quy tắc frame worker (`extensions/studioflow-core/hf/frame-worker.md`): không animate `autoAlpha`/`visibility`/`display` trên phần tử clip; dùng `opacity`.
- FR-CP-58-02: App tự sửa (`src/hf/clip-fix.ts`): trong tween `to`/`from`/`fromTo`/`set` có selector chuỗi (`#id`, `.class`, danh sách phẩy) trỏ vào phần tử clip → đổi khóa `autoAlpha` thành `opacity` (bỏ qua nội dung chuỗi); tween phần tử thường giữ nguyên. Chạy ở bước dựng frame (trước lint/check) và ở `finalize` (sau build graph); frame đổi → `markBuilt … contentOnly` rồi lắp lại index (không để index cũ, 046).
- FR-UI-58-03: CTA `reveal` "Mở thư mục" cho tệp `.mp4` trong kết quả bước và thẻ "render xong" (041) — mở File Explorer chọn sẵn video (`shell.showItemInFolder`, IPC `shell:reveal`).

## AC
- `clip-fix.test.ts`: selector clip (id + class), đổi đúng tween clip, giữ tween thường, chuỗi có ngoặc, không đổi khi không cần.
- Chạy thử trên frame thật `fr_xklyxpsa` của vd_jegcn38v: 3 tween được sửa, không còn `autoAlpha`.
- `doc-format.test.ts`: thẻ render xong + bước có `.mp4` có CTA `reveal`.
