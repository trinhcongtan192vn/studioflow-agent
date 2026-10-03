# Implementation Plan: HyperFrames adapter, frame build, `index.html`, asset library

**Branch**: `011-hyperframes-adapter-frame-build` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

## Summary
`packages/core/src/hf/`: `cli.ts` (bin ghim, `lint`/`check` JSON, kiểm `data-sf-id`), `outputs.ts` (output profile), `frame-file.ts` (kiểm file frame + `data-sf-id`), `transitions.ts` (registry vendored), `captions-html.ts`, `index-html.ts` (+ builder nút `index`), `project.ts` (`hyperframes.json`), `packet.ts` (frame packet + chỉ dẫn), `frame-build.ts` (executor), `design-system.ts` (executor). `packages/core/src/assets/`: `image-info.ts`, `library.ts`, `tools.ts`. Engine: executor cho bước agent `frame-build`; `stepComplete(step, outputs, frame_id)`. `WorkflowService.setAgentRuntime()` cho phiên `frame`. Replay runtime: thực thi lại tool có tác dụng. CLI `hf`, `frame`, `asset`. Gói: `extensions/studioflow-core/hf/transitions.json`, `frame-worker.md`, `frame.md.tpl` mặc định; `extensions/outputs/yt-1080p30/output.json`.

## Technical Context
TS/Node 22 · hyperframes 0.8.115 (đã ghim ở 010) · Chrome headless của HyperFrames cho `check` · Storage: `compositions/frames/*.html`, `compositions/captions.html`, `index.html`, `hyperframes.json`, `frame.md`, `.sf/frames.json`, `<channel>/assets/` · Testing: unit (HTML sinh, packet, header ảnh, tìm asset), integration (runtime giả viết frame qua Gateway → `hyperframes lint` thật), live (Claude dựng 2 frame, record → replay; `check` thật).

## Constitution Check
- [x] I · [x] II/III (CLI JSON) · [x] IV · [x] V (`FramePacket`, `AssetManifest`, `CaptionGroups`, `CaptionOverrides`, `Frame`, `Layer` từ `docs/contracts`) · [x] VI (mọi ghi qua module ghi; HyperFrames chỉ đọc) · [x] VII (log mỗi phiên frame, lệnh HF) · [x] VIII · [x] IX (adapter HyperFrames là ranh giới đã định; không thêm lớp chuyển đổi) · [x] X (HyperFrames thật trong test; LLM ghi/phát lại).

## Complexity Tracking
Không có vi phạm.
