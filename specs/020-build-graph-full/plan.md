# Implementation Plan: Build graph đầy đủ

**Branch**: `020-build-graph-full` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

## Summary
`graph/graph.ts`: loại nút mới, `explicitOnly` (render), trạng thái ghim (đọc `state.pinned_frames`), `acceptPinned`, `markBuilt`, planner theo loại (`BuilderRegistry.registerPlanner`), `PlannedJob.engine/est_cost_usd/from_cache`. Builder: `graph/asset-builder.ts` (gọi `generateImage`), `graph/frame-builder.ts` (nhận file hợp lệ chưa ghi nhận; sinh lại qua `FrameRebuilder`), `graph/credits-builder.ts`, `graph/render-builder.ts`. `WorkflowService.rebuildFrames` (chạy executor frame-build với `only` + `waitFrame`, bỏ build trước/sau để tránh khóa lồng). `hf/packet.ts` nhận asset từ nút `asset`.

## Technical Context
TS/Node 22 · Testing: integration `graph-full.test.ts` (TTS/ảnh giả, bộ dựng lại frame giả), cập nhật test graph cũ theo nút mới.

## Constitution Check
- [x] I · [x] II/III · [x] IV · [x] V (D4 mục 8, D9 mục 5) · [x] VI · [x] VII · [x] VIII · [x] IX · [x] X.

## Complexity Tracking
Không có vi phạm.
