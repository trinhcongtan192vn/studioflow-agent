# Implementation Plan: Lịch GPU theo pha

**Branch**: `019-gpu-scheduler-phases` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

## Summary
`jobs/gpu.ts` (`GpuScheduler`: lớp tài nguyên/ngân sách theo engine, lease re-entrant, hàng chờ, giữ/đẩy VRAM qua hook). `JobQueue` nhận `gpu` (tùy chọn): tick bỏ qua job engine GPU không vừa, run giữ lease, `released` → tick; `enqueue` có `not_before_ms`; `updatePayload`. `runCapability` nhận `gpu` (tùy chọn, mặc định bộ lịch toàn cục của core gắn qua `setGpuScheduler`). Core: tạo scheduler từ cấu hình app + registry (`engineOf` từ manifest, hook `release('offload')` của adapter theo engine). Render job lấy lease. `startGraphBuild` gộp + cửa sổ.

## Technical Context
TS/Node 22 · Testing: unit `gpu-scheduler.test.ts` (quy tắc 1–2, re-entrant, hủy khi chờ, ngân sách > tổng), integration `gpu-queue.test.ts` (hàng đợi + provider giả có engine/release, SC-001; gom SC-002).

## Constitution Check
- [x] I · [x] II/III · [x] IV · [x] V (D4 mục 6, D3 7.2) · [x] VI · [x] VII · [x] VIII · [x] IX · [x] X.

## Complexity Tracking
Không có vi phạm.
