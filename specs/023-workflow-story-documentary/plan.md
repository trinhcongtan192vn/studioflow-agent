# Implementation Plan: story-documentary + refine storyboard

**Branch**: `023-workflow-story-documentary` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

## Summary
Engine: `StepRunContext.agent` (bọc `runAgent`) và `waitComplete` (đăng ký hoàn tất bước cho phiên producer). `workflow/storyboard.ts`: executor `storyboard` — không refine → `ctx.agent`; refine → `runRefine` (009) với producer = phiên `producer` mới mỗi vòng qua `AgentRuntime` (như frame-build), critic = `TextService.review`, kiểm `schema` + `coverage`; ghi vòng/provenance/tóm tắt như 009. `workflow/assets.ts`: executor `assets` (graph.build `asset`, phần còn lại giao `ctx.agent`), objective `assets_resolved`. Gói `extensions/workflows/story-documentary`, rubric `storyboard-default`.

## Technical Context
TS/Node 22 · Testing: integration `storyboard-refine.test.ts` (runtime giả + text giả), `assets-step.test.ts`, `story-documentary.test.ts` (E2E giả lập, HyperFrames/FFmpeg thật), live tùy chọn `m2-live.test.ts`.

## Constitution Check
- [x] I · [x] II/III · [x] IV · [x] V (D6 4.1, D5 4) · [x] VI · [x] VII · [x] VIII · [x] IX · [x] X.

## Complexity Tracking
Không có vi phạm.
