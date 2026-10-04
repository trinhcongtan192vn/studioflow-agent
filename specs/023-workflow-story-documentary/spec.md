# Feature Specification: Workflow `story-documentary` + `refine-loop` storyboard

**Feature Branch**: `023-workflow-story-documentary`

**Created**: 2026-10-04

**Status**: Draft

**Input**: Backlog dòng 023: "`workflow-story-documentary` + `refine-loop` storyboard".

**Phủ yêu cầu**: FR-WF-06, FR-SC-07, AC-M2-01, AC-M2-06 (một phần — đăng YouTube do người dùng làm).

**Dựa trên `docs/`**: D6 mục 1 (manifest), 2 (bảng bước: `storyboard` producer khi có refine, `assets` agent + engine, gate "mọi layer có asset"), 3 (điều phối), 4.1–4.3 (refine-loop, kiểm khách quan `coverage`, rubric), 7 (skill) · D5 mục 2/4 (phiên `producer`: một vòng, không lịch sử; tool như bảng) · D3 mục 4 (`Scene`, `Frame`, `Layer.asset_request`) · D4 mục 8 (nút `asset`, 020) · FN-023 (bước khác biệt, tham số ảnh) · FN-common.

## User Scenarios & Testing *(mandatory)*

### US1 — `refine-loop` cho storyboard (P1) — FR-SC-07
1. Bước `storyboard` có `refine.enabled` → mỗi vòng sản xuất là **một phiên `producer` mới** (không lịch sử chat; tool theo D5) viết `STORYBOARD.md` và báo `workflow.step_complete`; vòng sửa nhận danh sách vấn đề của critic + kiểm khách quan không qua.
2. Critic: `text.review` với rubric `storyboard-default` (gói workflow có thể ghi đè), định tuyến D6 4.1 (model ngoài nếu có khóa, không thì Claude khác tầng).
3. Kiểm khách quan: `schema` (STORYBOARD hợp lệ) + `coverage` (mỗi line thuộc đúng một frame, mọi frame có layer).
4. Dừng theo D6 4.1 (min/max vòng, ngưỡng, không còn vấn đề critical/major, kiểm qua); ghi `reviews/storyboard/round-<n>.json`, provenance, `steps.storyboard.refine`; tóm tắt các vòng vào thẻ duyệt.
5. Không có refine → bước chạy như M1 (phiên `main` theo skill).

### US2 — Bước `assets` (P1)
1. Engine dựng các nút `asset` (020) cho layer `asset_request.source = generate` (ảnh nền 1664×928, vật thể 1024² RGBA, seed theo scene).
2. Layer `source: library | user` chưa có `asset_id` → giao phiên `main` theo skill (tìm `asset.search`, gắn `asset_id`, hoặc đổi sang vẽ bằng code); không có → xong ngay.
3. Gate `assets_resolved`: mọi layer cần asset (`image`/`object`/`background` có `asset_request` khác `code`, hoặc có `asset_id`) đã có asset (nút `asset` fresh hoặc `asset_id` trong thư viện kênh).

### US3 — Gói workflow `story-documentary` (P1) — FR-WF-06
1. `extensions/workflows/story-documentary/`: `workflow.yaml` (câu hỏi brief thêm mốc thời gian, địa danh, nhân vật, nguồn; script rubric `script-documentary` 6–12 beat; storyboard refine + duyệt; voice; assets; frames; captions; music; finalize + duyệt; meta; render), `rubrics/script-documentary.yaml` (`accuracy` 0,3), skill `story-documentary` (storyboard theo scene có `setting`, `time_of_day`, `mood`, `look`; `asset_request` sinh ảnh với prompt tiếng Anh; nhân vật lịch sử dùng `reference_asset_ids`; mật độ 1 ảnh/15–25 giây).
2. Hồi quy: chạy hết các bước tới MP4 phát hành với TTS/ASR/ảnh giả, producer/critic giả.

### Edge Cases
- Producer không báo xong → vòng đó `E_STEP_INCOMPLETE` (bước lỗi).
- Ngân sách không đủ một vòng → hỏi người dùng (D6 4.1, như 009).

## Requirements *(mandatory)*
- **FR-001**: `StepRunContext.agent` (chạy bước bằng phiên `main`) và `waitComplete` (chờ `workflow.step_complete` của bước, cho phiên `producer`).
- **FR-002**: Executor `storyboard` (refine với producer agent + critic text, hoặc phiên main khi không refine).
- **FR-003**: Executor `assets` + objective `assets_resolved`.
- **FR-004**: Rubric `storyboard-default` (studioflow-core), gói `story-documentary`.
- **FR-005**: Live (tùy chọn, `SF_M2_LIVE=1`): video tài liệu ngắn với Claude + OmniVoice + Qwen-Image thật.

## Success Criteria
- **SC-001**: Executor storyboard: critic chấm thấp vòng 1 (vấn đề major) → vòng 2 phiên producer mới nhận vấn đề → dừng khi đạt; 2 file `reviews/storyboard/round-*.json`; mỗi vòng một phiên khác nhau.
- **SC-002**: E2E `story-documentary` (giả lập) tới MP4 phát hành; asset sinh nằm trong `public/`, frame packet có asset.
- **SC-003** (Tan): AC-M2-01 video 8–12 phút thật; AC-M2-06 đăng YouTube.

## Ngoài phạm vi
Blueprint `timeline`/`map-route`/`portrait-caption`/`archive-photo` (frame agent vẽ bằng code; gói blueprint làm khi có trường hợp thứ hai), look/effects/overlays (M3), delta tự động từ upstream (`sf ext build`).
