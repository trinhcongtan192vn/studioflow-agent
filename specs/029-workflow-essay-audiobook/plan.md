# Implementation Plan: Workflow `essay-audiobook`

**Branch**: `029-workflow-essay-audiobook` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

## Summary
Docs: D6 `config_defaults`, D3 7.1 tầng `workflow`, 7.2 `voice.pause_after_ms`; sinh lại hợp đồng. Core: `ConfigTier` + `workflowTierAllowed`, `resolveConfig` đọc `config_defaults` của workflow đã chọn (cache theo mtime), kiểm trong `loadPack`; `withDefaultPause` (model, duration); kiểu caption trong `buildCaptionsHtml`; chương theo timeline; `EXTENSIONS_DIR` tách ra `paths.ts` (tránh vòng import config ↔ agent). Gói `essay-audiobook`. Test: `essay-audiobook.test.ts` (E2E), `workflow-config.test.ts`; helper E2E dùng chung.

## Constitution Check
- [x] I · [x] II/III · [x] IV · [x] V (sửa D3/D6 theo quyết định của Tan, sinh lại hợp đồng) · [x] VI · [x] VII · [x] VIII · [x] IX · [x] X.

## Complexity Tracking
Thêm một tầng cấu hình (R1).
