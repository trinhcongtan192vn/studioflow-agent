# Implementation Plan: Kiểm hồ sơ kênh

**Branch**: `022-channel-profile-validate` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

## Summary
`domain/channel-validate.ts` (`validateChannel`, thư mục gói phong cách `styleDirs`). CLI `modules/channel/cli.ts` (`sf channel validate`). `artifact.write` thêm `channel_validation` khi ghi `channel.json`/`profile/**`; host `channel.open` thêm `validation`. Mã lỗi `E_CHANNEL_INVALID` (errors.local). D13 mục 6: `lut`, `mouths/`.

## Technical Context
TS/Node 22 · Testing: integration `channel-validate.test.ts` (SC-001, tool, CLI), `asset-reuse.test.ts` (SC-002).

## Constitution Check
- [x] I · [x] II/III · [x] IV · [x] V (D6 6.3) · [x] VI (chỉ đọc) · [x] VII · [x] VIII · [x] IX · [x] X.

## Complexity Tracking
Không có vi phạm.
