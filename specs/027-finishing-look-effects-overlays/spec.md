# Feature Specification: Hoàn thiện — look màu, hiệu ứng media, overlay

**Feature Branch**: `027-finishing-look-effects-overlays`

**Created**: 2026-10-04

**Status**: Draft

**Input**: Backlog dòng 027: "`finishing-look-effects-overlays`".

**Phủ yêu cầu**: FR-CP-04 (look màu theo kênh + biến thể theo scene), FR-CP-05 (media effect dry-run trước khi áp; overlay theo quy tắc kênh).

**Dựa trên `docs/`**: D6 mục 1–2 (bước `look`/`effects`/`overlays`, `skip_if.phase_before: M3`) · D3 mục 5.6 (`Scene.look`, `Frame.effects`, `Frame.overlays`), 7.2 (`look.id`, `overlay.rules`) · D4 mục 2.4 (tool `grade.compare`, `media.treatment`), 8.1 (`frame_html`, `index`) · D9 mục 3.3, 4 (Studio: `data-color-grading*`, read-back look) · D13 mục 6 (gói phong cách) · FN-common mục 6–7.

## User Scenarios & Testing *(mandatory)*

### US1 — Look màu (P1, FR-CP-04)
App ở giai đoạn M3 (`APP_PHASE`): bước `look` chạy. Look của frame = `sf-frame.config.look.id` → `sf-scene.config.look.id` → `sf-scene.look` → video/kênh/app (`look.id`, mặc định `neutral`). Giá trị là id gói phong cách hoặc **biến thể** (`variants`) của gói look gốc. Gói phong cách có `grading` (bản vá color-grading HyperFrames). Khi dựng frame, look được **nướng vào ảnh** (`public/looks/<ảnh>-<hash>.png`, research R2); `<img>` dùng ảnh đã grade, gốc giữ ở `data-sf-src`. Đổi look → chỉ áp lại hoàn thiện, không gọi agent. Chữ/hình HTML không grade. `grade.compare` so sánh các look trên ảnh thư viện.

### US2 — Hiệu ứng media (P1, FR-CP-05)
`sf-frame.effects[]` = khóa hiệu ứng HyperFrames (`bloom`, `filmArtifacts`, `grain`, `vignette`…; tùy chọn `:<mức>`). `media.treatment {asset_id, effect, mode}`: `dry_run` kiểm bằng `hyperframes media-treatment --apply --dry-run` + ngân sách hiệu ứng nặng (làn `multipass`, 2/phút video); `apply` (sau dry-run qua) thêm hiệu ứng vào `sf-frame.effects` của các frame có layer dùng ảnh đó (hỏi người dùng nếu `STORYBOARD.md` đã duyệt). Khi dựng frame: hiệu ứng → `data-color-grading` (JSON đã chuẩn hóa) trên `<img>`/`<video>`, áp lúc render.

### US3 — Overlay (P1, FR-CP-05)
`sf-frame.overlays: [{block, vars}]` — khối overlay của gói phong cách (`overlays/<id>/overlay.{yaml,html}`; app có `lower-third`, `location-tag`). Nút `index` tạo mỗi khai báo một sub-composition `compositions/overlays/ov-<fr>-<n>.html` (biến đã điền, màu nhấn theo look), đặt ở tầng overlay: frame (track 0/1) → overlay (2) → caption (3) (FN-common 7). Thiếu biến bắt buộc / khối không có → lỗi.

### US4 — Bước workflow (P1)
`look`/`effects`/`overlays` là bước agent: engine giao kèm danh mục + hiện trạng; gate khách quan `look_valid`, `effects_valid` (dry-run mọi bản vá, ngân sách), `overlays_valid`. Skill workflow có mục cho từng bước.

## Requirements *(mandatory)*

- **FR-001** `APP_PHASE = M3`.
- **FR-002** Hash `frame_html` tách phần hoàn thiện (`finish`: look + effects) khỏi nội dung; dự án không dùng hoàn thiện giữ nguyên hash.
- **FR-003** Builder `frame_html`: nội dung không đổi → chỉ áp lại hoàn thiện; frame do bước `frame-build` dựng ghi nhận hash nội dung để lần build sau áp hoàn thiện.
- **FR-004** Nướng look gom mọi cặp (ảnh, look) còn thiếu của video vào một lần render HyperFrames (`png-sequence`), cắt bằng FFmpeg; cache theo hash ảnh + grading.
- **FR-005** Read-back Studio (025): `data-color-grading` có `preset` trùng gói phong cách → `sf-frame.config.look.id`.
- **FR-006** `skip_if.config` so với giá trị cấu hình đã giải theo tầng.

## Success Criteria *(mandatory)*

- **SC-001** E2E `story-documentary`: ảnh frame dùng bản đã nướng look kênh; `media.treatment` dry-run rồi apply `grain` → frame có `data-color-grading` với `grain`; render phát hành thành công.
- **SC-002** E2E `narrated-explainer`: overlay `lower-third` ở track 2, caption track 3, biến đã điền; render phát hành thành công.
- **SC-003** Unit: áp/bỏ hoàn thiện idempotent; hash nội dung bỏ qua effects/overlays/look; khối overlay kiểm biến; read-back look.
