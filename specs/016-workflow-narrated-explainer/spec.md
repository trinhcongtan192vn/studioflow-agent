# Feature Specification: Workflow `narrated-explainer`

**Feature Branch**: `016-workflow-narrated-explainer` · **Created**: 2026-10-04 · **Status**: Draft

**Input**: Backlog dòng 016. **Phủ**: FR-WF-05, AC-M1-01, AC-M1-03 (AC-M1-05 ở 013). **Dựa trên**: D6 mục 1–4, 7 · FN-016 · FN-common · D3 mục 5.5 (STORYBOARD) · D7 (workflow cụ thể — nội dung ở FN-016).

## User Scenarios & Testing
### US1 — Từ ý tưởng tới MP4 phát hành (P1) — FR-WF-05, AC-M1-01
Gói `extensions/workflows/narrated-explainer/` (manifest D6, skill cho bước agent). Bước: design → script (refine, duyệt) → storyboard (agent, duyệt) → voice (TTS + ASR) → assets (agent: thư viện → code → người dùng) → look (M3, bỏ qua) → frames (phiên frame) → effects/overlays (M3, bỏ qua) → captions → music (agent: `music.find`) → finalize (graph, check, contact sheet, render nháp; duyệt) → meta (refine) → render phát hành.
### US2 — Sửa một câu (P1) — AC-M1-03
Sửa chữ một line → chỉ `audio.line`/`asr.line` của line đó + `audio_meta` + `captions` dựng lại.
### US3 — Finalize (P1)
Executor `finalize`: build mọi nút (index), `hyperframes check` không lỗi, contact sheet `.sf/snapshots/`, render nháp; gate `graph_fresh *` + `duration` (`check.duration_tolerance` quanh `target_duration_ms`); thẻ duyệt có đường dẫn bản nháp. Executor `captions`.

## Requirements
- **FR-001** gói workflow + skill. **FR-002** executor `captions`, `finalize`, objective `duration`. **FR-003** test E2E tất định (hồi quy "dự án mẫu chạy hết tới MP4"). **FR-004** test nghiệm thu thật opt-in (`SF_LLM=record SF_M1_LIVE=1`).

## Success Criteria
- **SC-001** E2E tất định: mọi bước `done`/`skipped`, 4 điểm duyệt (brief, script, storyboard, finalize), MP4 phát hành + `description.txt`.
- **SC-002** Nghiệm thu thật trên máy tham chiếu (Claude + GPU) ra MP4 phát hành; AC-M1-01 đầy đủ (3–5 phút, người duyệt thật) do Tan chạy trong app.

## Ngoài phạm vi
Refine storyboard (M2), sinh ảnh (M2), look/effects/overlays (M3), `sf ext build` fork/delta.
