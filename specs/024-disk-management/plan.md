# Implementation Plan: Quản lý dung lượng

**Branch**: `024-disk-management` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

## Summary
`packages/core/src/disk/`: `usage.ts` (kích thước thư mục, `statfs` ổ đĩa, phân loại render theo `render.json.mode`), `clean.ts` (`cleanChannel`, `enforceCacheBudget`). `WriteStore.removeDerived` mở rộng: render nháp (không phải `release`), `.sf/backups` khi người dùng chọn. Hàng đợi: `JobKind.needsDisk` + `diskGuard`. Core: gọi `enforceCacheBudget` sau job (giới hạn 1 lần/phút/kênh). Host IPC `disk.usage`/`disk.clean`; desktop `Settings` thêm mục Dung lượng; CLI `sf disk`.

## Technical Context
TS/Node 22 (`fs.statfsSync`) · Testing: integration `disk.test.ts` (SC-001..003), UI test hiện màn Dung lượng.

## Constitution Check
- [x] I · [x] II/III · [x] IV · [x] V (D4 mục 7, 11) · [x] VI (xóa qua WriteStore, chỉ dẫn xuất) · [x] VII · [x] VIII · [x] IX · [x] X.

## Complexity Tracking
Không có vi phạm.
