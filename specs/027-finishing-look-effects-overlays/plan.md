# Implementation Plan: Hoàn thiện — look, hiệu ứng, overlay

**Branch**: `027-finishing-look-effects-overlays` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

## Summary
`finish/styles.ts` (gói phong cách, khối overlay), `finish/grading.ts` (look frame, hiệu ứng, chuẩn hóa dry-run, `applyFinish`), `finish/bake.ts` (nướng look), `finish/overlays.ts` (instance overlay), `finish/check.ts` (báo cáo, gate, executor bước), `finish/tools.ts` (`grade.compare`, `media.treatment`). Graph: phần `finish` trong hash `frame_html`, `contentInputHash`, `markBuilt({contentOnly})`, overlay trong hash `index`. `index-html`: track overlay 2, caption 3. Gói `extensions/styles/{neutral,warm-archive,documentary-muted,vintage-film,core-overlays}`. Skill workflow thêm mục bước. `APP_PHASE = M3`.

## Technical Context
TS/Node 22; HyperFrames 0.8.115 (`media-treatment`, `grade-compare`, `render --format png-sequence`); FFmpeg crop · Testing: unit `finish.test.ts`; E2E `story-documentary`, `narrated-explainer`; 007 engine tests.

## Constitution Check
- [x] I · [x] II/III · [x] IV · [x] V (D3/D4/D6) · [x] VI (ghi qua WriteStore/Gateway) · [x] VII · [x] VIII · [x] IX · [x] X.

## Complexity Tracking
Nướng look thêm một lần render HyperFrames mỗi lần đổi look (R2) — đổi lấy render toàn video nhanh ~8×.
