# Feature Specification: HyperFrames adapter, dựng frame bằng sub-agent, lắp `index.html`

**Feature Branch**: `011-hyperframes-adapter-frame-build`

**Created**: 2026-10-04

**Status**: Draft

**Input**: Backlog dòng 011: "adapter, sub-agent frame, lắp `index.html`, transition, thư viện asset cơ bản (`asset.import`, `asset.search`, `assets/manifest.json`)".

**Phủ yêu cầu**: FR-CP-01, FR-CP-03, FR-IM-01 (+ trả lời spike S3).

**Dựa trên `docs/`**: D4 mục 2.4 (`asset.import`, `asset.search`, `workflow.step_complete` có `frame_id`), 8.1 (nút `index`), 9.1 (HyperFrames adapter, `E_HF_ID_LOST`) · D6 mục 2 (bước `design-system`, `frame-build`), 5 (frame packet) · D5 mục 2, 4 (phiên `frame`, phạm vi ghi `allowed_paths`), 6 · D3 mục 1 (bố cục video/kênh), 4 (`Frame`, `Layer`, `Scene`), 5.5, 5.8, 5.13 (`AssetManifest`) · D9 mục 3 (`data-sf-id`) · FN-common mục 2–4 (asset, caption, transition) · D12 (ghi/phát lại LLM).

## Bối cảnh & mục tiêu
Sau storyboard và giọng, mỗi frame được một phiên agent `frame` dựng thành sub-composition HyperFrames giữ `data-sf-id` của các layer; app lắp `index.html` (frame, giọng, caption, transition) để HyperFrames lint/check/render. Asset người dùng nạp vào thư viện kênh dùng được trong frame; hình vẽ bằng code (SVG/HTML, chữ, biểu đồ) do agent viết trực tiếp.

## User Scenarios & Testing *(mandatory)*

### US1 — Dựng frame bằng sub-agent (P1) — FR-CP-01
1. **Given** video đã có `STORYBOARD.md`, `audio_meta.json`, `frame.md`, **When** bước `frame-build` chạy, **Then** mỗi frame một phiên `frame` (song song `frame_build.parallel`, mặc định 2) nhận frame packet (D6 mục 5), chỉ được ghi `compositions/frames/<fr>.html`, báo `workflow.step_complete` kèm `frame_id`; bước xong khi mọi frame đã báo.
2. File frame phải là một `<template>` có `data-composition-id="<fr>"`, đủ `data-sf-id` của mọi `layers[].id`; sai → gửi lại phiên kèm lỗi một lần, vẫn sai → bước `failed` (liệt kê frame).
3. Frame đã có file và frame packet không đổi → không dựng lại (hash packet trong `.sf/frames.json`).

### US2 — Lắp `index.html` (P1) — FR-CP-01, FR-CP-03
1. Nút `index` sinh `index.html`: root `main` kích thước theo output profile; frame theo thứ tự storyboard (`data-composition-src`, mốc từ `frame_timing`); `<audio>` từng line ở mốc tuyệt đối; caption là sub-composition `compositions/captions.html` sinh từ `caption_groups.json` (+ ghi đè text/mốc từ `caption-overrides.json`).
2. Transition theo `transition_in` của frame đến (registry vendored từ HyperFrames: `crossfade`, `blur-crossfade`, `push-slide`, `zoom-through`, `squeeze`; `cut`/không có → cắt thẳng): kéo dài frame đi, frame đến hiện chồng; tổng thời lượng không đổi.
3. `hyperframes lint` trên video không lỗi; `data-sf-id` còn nguyên sau mọi lệnh HyperFrames (thiếu → `E_HF_ID_LOST`).

### US3 — Thư viện asset cơ bản (P1) — FR-IM-01
1. `asset.import {path (uploads/…), tags, description}` → asset `as_*` vào `<channel>/assets/` + `assets/manifest.json` (D3 `AssetManifest`, kích thước/alpha đọc từ header ảnh) và chép vào `public/` của video hiện tại; trả `{asset_id}`.
2. `asset.search {query, tags?}` → asset khớp theo tag/mô tả/tên, xếp hạng.
3. Frame packet liệt kê asset của các layer (`asset_id`) với `file` trong `public/`.

### US4 — `design-system` (P2)
Bước `design-system` sinh `frame.md` từ `profile/frame.md.tpl` của kênh (thay `{{config:…}}`), không có → mẫu mặc định của app.

### Edge Cases
- Frame không có line: thời lượng `frame.min_duration_ms`.
- Thiếu `audio_meta.json` (video im lặng) → index không có audio, frame theo `min_duration_ms`.
- Agent dừng không báo xong một frame → frame đó lỗi `E_STEP_INCOMPLETE`.
- Asset không phải ảnh/video/audio hỗ trợ → `E_AUDIO_UNSUPPORTED`/`E_SCHEMA_INVALID` rõ ràng.

## Requirements *(mandatory)*
- **FR-001**: Adapter CLI HyperFrames ghim (`extensions/providers/hf.cli/version.json` = phiên bản gói đã cài; lệch → `E_PROVIDER_UNAVAILABLE`), chạy `node <bin> <lệnh>` không mạng, tắt telemetry; `lint --json`, `check --json`.
- **FR-002**: `hyperframes.json` của video do adapter tạo/cập nhật.
- **FR-003**: Frame packet D6 mục 5 + chỉ dẫn phiên `frame` (vai frame worker theo hợp đồng HyperFrames, rút gọn cho StudioFlow).
- **FR-004**: Executor `frame-build`: phiên `frame` song song, chờ `step_complete(frame_id)`, kiểm file frame, thử lại 1 lần, `.sf/frames.json`.
- **FR-005**: Builder nút `index` + `compositions/captions.html`; transition registry.
- **FR-006**: Kiểm `data-sf-id` trước/sau lệnh HyperFrames (`E_HF_ID_LOST`); gate `frame-build`: file frame hợp lệ + `lint` không lỗi.
- **FR-007**: `asset.import`, `asset.search`, `assets/manifest.json` kênh; đọc kích thước PNG/JPEG/GIF/WebP/SVG.
- **FR-008**: Executor `design-system`.
- **FR-009**: Phát lại phiên agent thực thi lại tool có tác dụng (`artifact.write`, `workflow.step_complete`) qua Gateway, để test phiên `frame` chạy lại được (D12).
- **FR-010**: CLI `sf hf lint|check --channel --video`, `sf frame build --channel --video [--frames fr_a,fr_b]`, `sf asset import|search`.

## Success Criteria
- **SC-001**: Video mẫu 2 frame: phiên `frame` thật (Claude, record) dựng xong, `hyperframes lint` + `check` không lỗi, `data-sf-id` đủ; phát lại (replay) cho cùng kết quả.
- **SC-002**: S3 (e): `data-sf-id` còn nguyên sau `lint`, `check` (render: 013).

## Ngoài phạm vi
Sinh ảnh (`image.*`, M2), bước `assets` đầy đủ (M2), nút `frame_html`/ghim (020), Studio (017/M3), nhạc/SFX trong index (012), render (013), look/effects/overlays (M3), `sf ext build` fork/delta (M2+).

## Assumptions
- Không chạy script `faceless-explainer` gốc: định dạng storyboard/audio của nó khác D3; app tự lắp index theo quy ước của HyperFrames (xem research R1) — trả lời S3 (c)(d)(g).
