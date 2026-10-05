# Feature Specification: Workflow `short-film`

**Feature Branch**: `031-workflow-short-film`

**Created**: 2026-10-05

**Status**: Draft

**Input**: Backlog dòng 031: "`workflow-short-film`: cast, nhiều giọng, animatic".

**Phủ yêu cầu**: FR-WF-08, FR-VO-05, AC-M5-01 (phần M5; khẩu hình ở 032).

**Dựa trên `docs/`**: D6 mục 1–2 (`cast`, `script` screenplay, `animatic`, `lipsync` skip), D3 mục 5.6 (`CastMember`: `voice_id`, `emotions`, `expressions`, `caption_color`), 5.11 (`RenderRecord.mode = animatic`), D4 mục 8.1 (`audio.line`), FN-031/032, FN-common.

## User Scenarios & Testing *(mandatory)*

### US1 — Phim ngắn nhiều nhân vật (P1)
Brief (thể loại, ≤ 4 nhân vật + người dẫn, bối cảnh, file giọng mẫu) → `story` (dàn ý `STORY.md`, rubric `story-outline`, duyệt) → `cast` (agent: giọng clone từ file mẫu, ảnh chuẩn + bộ biểu cảm, màu phụ đề; `CAST.md`, duyệt; app gán `ca_…` và lưu nhân vật cấp kênh `characters/<ca>/cast.json`) → `script` screenplay (rubric `script-film`; gate: mỗi người nói có giọng đã clone) → `storyboard` theo shot (refine) → `voice` (giọng từng nhân vật; line có `emotion` dùng giọng cảm xúc của nhân vật) → `assets` → `animatic` (khung tĩnh + lời, duyệt) → `lipsync` (bỏ qua khi `lipsync.enabled = false`) → frames → captions (màu theo người nói) → music → finalize → meta → render.

## Requirements *(mandatory)*

- **FR-001** `artifact.write CAST.md`: nhân vật mới trong `sf-cast` được gán `ca_…` (trả `assigned_ids`).
- **FR-002** Executor `cast`: giao phiên `main`, rồi lưu nhân vật (`role: character`, có `voice_id`) vào `characters/<ca>/cast.json` (gộp với bản cũ).
- **FR-003** Giọng cảm xúc (FR-VO-05): `CastMember.emotions[<emotion>]` (ref audio) → voice prompt `characters/<ca>/emotions/<emotion>.pt` tạo một lần bằng `voice.profile`; `audio.line` có `emotion_ref` (hash ref) trong hash đầu vào khi áp dụng.
- **FR-004** Objective `speakers_voiced`.
- **FR-005** Executor `animatic`: khung tĩnh theo `frame_timing` (ảnh layer có asset, không có → thẻ màu), lời đọc theo mốc timeline, FFmpeg → `renders/<rd>/video.mp4` + `render.json` `mode: animatic`.
- **FR-006** Caption theo người nói: `data-sf-speaker`, màu `CastMember.caption_color`.
- **FR-007** Gói `extensions/workflows/short-film/` (manifest, rubric `story-outline`, `script-film`, skill, plugin).

## Success Criteria *(mandatory)*

- **SC-001** E2E (giả + HyperFrames/FFmpeg thật): duyệt brief → story → cast → script → animatic → finalize, render phát hành; nhân vật lưu cấp kênh; voice prompt cảm xúc `sad`; animatic MP4 `mode: animatic`; caption có màu theo nhân vật; lipsync `skipped`.
