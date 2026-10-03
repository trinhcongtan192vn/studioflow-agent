# Implementation Plan: Render

**Branch**: `013-render` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

## Summary
`packages/core/src/render/`: `hf-render.ts` (`hyperframes render` bản ghim vào thư mục tạm, tiến độ %, hủy bằng kill cây tiến trình), `post.ts` (loudnorm hai lượt về `loudness_lufs` của profile, chữ "NHÁP" cho nháp, ffprobe), `render.ts` (build graph → gate → render → hậu kỳ → `renders/<rd>/` qua `WriteStore.importFile`; `render.json`; CREDITS + description khi phát hành; khôi phục), `tools.ts` (tool `render.video`, job `render` không idempotent + `onInterrupted`, executor bước `render`). CLI `sf render video`.

## Technical Context
HyperFrames 0.8.115 (Chrome headless của nó) · FFmpeg 8.1 · Testing: integration render thật (nháp, phát hành + gate, hủy ≤ 5 s, khôi phục).

## Constitution Check
- [x] I · [x] II/III · [x] IV · [x] V (`RenderInput`, `RenderRecord` D4/D3; kiểu job mở rộng từ hợp đồng) · [x] VI (MP4 render ra thư mục tạm ngoài project rồi `importFile` qua module ghi) · [x] VII (log `sf.render`, `render.json`) · [x] VIII · [x] IX · [x] X.

## Complexity Tracking
Không có vi phạm.
