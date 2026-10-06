# Implementation Plan: Chế độ tự động

**Branch**: `034-autopilot` | **Date**: 2026-10-06 | **Spec**: [spec.md](spec.md)

## Summary
- **docs:** D3 mục 7.2 (hai khóa), tech-defaults, D5 mục 5.1, D6 mục 3.1, PRD FR-WF-10, backlog 034; sinh lại contracts.
- **core:**
  - `workflow/autopilot.ts` (`autopilotOf`, `isKeyApproval`).
  - Engine: tự duyệt trong `runStep`, `invalidate`.
  - `PermissionBus.ask`: batch_gen.
  - `voiceExecutor`: giao agent khi thiếu giọng.
- **desktop:** nhãn chế độ ở tab Tiến độ.
- **skill:** `studioflow` mục "Chế độ tự động".
- **test:** `autopilot.test.ts` (SC-001..004); fixture settings tắt autopilot.

## Constitution Check
- [x] I · [x] II/III · [x] IV · [x] V · [x] VI · [x] VII · [x] VIII · [x] IX · [x] X.
