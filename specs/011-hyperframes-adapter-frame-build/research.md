# Research — 011 (gồm trả lời spike S3)

## R1. Không chạy script `faceless-explainer` gốc; app tự lắp index
- **Quan sát (hyperframes v0.8.115, repo `heygen-com/hyperframes` tag `v0.8.115`)**: script `assemble-index.mjs`, `transitions.mjs`, `captions.mjs`, `audio.mjs` đọc `STORYBOARD.md` theo định dạng riêng (`## Frame N` + trường `src`, `duration`, `voiceover`), `audio_meta.json` dạng `{bgm, voices[{frame, path}], sfx}` — khác D3 5.5/5.7 (khối `sf-frame` với ID, audio theo line). Chuyển hai chiều qua bản tạm `.sf/tmp/hf/` thêm một lớp dễ vỡ mà không thêm giá trị: phần việc của script là tất định (đặt mốc, gắn audio, chèn GSAP transition).
- **Decision**: `packages/core/src/hf/` tự sinh `index.html` và `compositions/captions.html` theo đúng quy ước HyperFrames mà `assemble-index.mjs`/`transitions.mjs` dùng (root `#root` `data-composition-id="main"`, frame là `div.scene` `data-composition-src` track 1/0 xen kẽ, caption track 2, giọng track 10, transition = kéo dài frame đi + template GSAP ở mốc frame đến). Registry transition vendored nguyên văn (`extensions/studioflow-core/hf/transitions.json`, ghi nguồn). CLI HyperFrames dùng cho `lint`, `check`, (013) `render`, `snapshot`.
- **Trả lời S3**: (c) script gốc không nhận trường bổ sung → không dùng script; (d) tên file theo ID (`compositions/frames/fr_*.html`) hợp lệ với HyperFrames (composition id = tên file, không cần `NN-`) → không cần `id-map.json`; (g) định dạng app tự sinh, ghi ở đây và trong test. (a)(b)(f) chạy hết đến MP4 kiểm ở 013; (e) xem R5.
- **Lệch spec**: D4 9.1 "chuyển định dạng … bản tạm `.sf/tmp/hf/` kèm `id-map.json`" (đánh dấu `[chờ S3]`) → không cần.

## R2. Phiên `frame`
- Phiên Agent SDK loại `frame` (D5): công cụ đọc + MCP `sf`; `allowed_paths = [compositions/frames/<fr>.html]`; chỉ dẫn gồm vai frame worker (rút từ `frame-worker-core.md` của HyperFrames: `<template>` duy nhất, `#root` không class, timeline paused đăng ký `window.__timelines["<fr>"]`, `class="clip"` đủ `data-start/duration/track-index`, không exit, keep-out caption 17% dưới, không render câu thoại) + yêu cầu StudioFlow (`data-sf-id` = `layers[].id`, phần tử phụ `el_*`, ghi bằng `artifact.write`, báo `workflow.step_complete {step_id, frame_id, outputs, new_element_ids}`) + packet JSON + nội dung `frame.md`.
- Song song bằng hàng đợi giới hạn `frame_build.parallel` (mặc định 2 `[chờ S4]`).

## R3. Transition
- Cơ chế `transitions.mjs`: tại ranh giới i→i+1 với `transition_in` của frame i+1: `data-duration` của frame i += `dur` (giữ khung cuối), frame i+1 giữ `data-start`; track 1/0 xen kẽ; template GSAP của registry vào `window.__timelines["main"]` tại `T = start(i+1)`. Tổng thời lượng không đổi; giọng/caption không dịch. `frame_timing.transition_start_ms` (= start − dur) không dùng cho index.

## R4. Phát lại phiên agent có tác dụng phụ
- `RecordReplayRuntime` chỉ trả sự kiện; phiên `frame` ghi file qua tool. **Decision**: tùy chọn `replayTools(ctx, name, input)` — khi phát lại, mỗi `tool_call` của tool Gateway có tác dụng (`artifact.write`, `workflow.step_complete`) được gọi lại qua Gateway với cùng ngữ cảnh phiên (kiểm phạm vi ghi như thật). Ghi (record) không đổi.

## R5. `data-sf-id` qua lệnh HyperFrames
- `lint`, `check` chỉ đọc (không có `--fix` trong v0.8.115 với các lệnh này) → hash file frame trước/sau bằng nhau (test). Adapter vẫn kiểm sau mỗi lệnh (`E_HF_ID_LOST`).

## R6. Thư viện asset
- Thư viện kênh `<channel>/assets/<as_id>.<ext>` + `<channel>/assets/manifest.json` (D3 mục 1); `asset.import` chép thêm vào `public/<as_id>.<ext>` của video. Bảng D6 mục 2 ghi bước `assets` ghi "`assets/manifest.json`" — hiểu là manifest thư viện kênh (asset sinh/nạp được thêm vào thư viện, FN-common mục 2).
- Kích thước ảnh: tự đọc header PNG/JPEG/GIF/WebP/SVG (không thêm phụ thuộc).

## R7. Canvas
- Kích thước từ output profile của video (`state.output_profile` → `extensions/outputs/<id>/output.json` theo chú thích D3 `OutputProfile`; app kèm `yt-1080p30`); chưa chọn → `yt-1080p30`.

## R8. Vòng sửa theo lint/check (đo 2026-10-04)
- Lần ghi đầu với Claude (sonnet): 2 frame qua kiểm file + `lint`, nhưng `check` bắt `contrast_aa_failure` (chữ đỏ trên nền giấy 1,71:1). **Decision**: như orchestrator HyperFrames — lỗi `lint`/`check` gom theo `compositions/frames/<fr>.html`, gửi lại đúng frame đó kèm phát hiện (một vòng), lắp lại index rồi kiểm lại; còn lỗi → bước `failed`. Vai worker thêm quy tắc tương phản WCAG AA. Sau đó: 2 frame, `check` 0 lỗi, ~45 s.
- Thời lượng frame trong packet đã gồm phần giữ khung cuối cho transition sang frame sau (R3) → không sửa file frame của agent sau khi ghi (khác `transitions.mjs` gốc vốn vá `data-duration` tại chỗ).
- GSAP nạp từ CDN jsdelivr (như mẫu HyperFrames); chạy offline hoàn toàn để 013/014.
