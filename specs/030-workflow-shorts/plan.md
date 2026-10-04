# Implementation Plan: Workflow `shorts`

**Branch**: `030-workflow-shorts` | **Date**: 2026-10-05 | **Spec**: [spec.md](spec.md)

## Summary
Profile dọc; `hf/safe-area.ts` (puppeteer-core + xem trước HyperFrames) + objective `text_safe_area`; objective `max_duration` (`workflow/duration.ts`); engine `source_video_id` → `read_only_videos`; Gateway đọc danh sách từ state; script prompt có kịch bản nguồn; packet: vùng an toàn lệch + dải caption karaoke; khóa `meta.hashtags`; gói `shorts` (manifest, rubric, skill, plugin); `sampleFrame` theo canvas packet. Test: `shorts.test.ts` (E2E thật HyperFrames/FFmpeg/Chrome).

## Constitution Check
- [x] I · [x] II/III · [x] IV · [x] V (D3 7.2 thêm khóa) · [x] VI · [x] VII · [x] VIII · [x] IX (Chrome headless, 127.0.0.1) · [x] X.

## Complexity Tracking
Phụ thuộc trực tiếp `puppeteer-core` (đã có qua HyperFrames).
