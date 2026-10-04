# Implementation Plan: Studio chế độ chỉnh

**Branch**: `025-studio-commit` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

## Summary
`studio/diff.ts` (parse5: ghép theo `data-sf-id`, phân loại thay đổi; tokenizer JS cho script), `studio/proxy.ts` (http + upgrade), `studio/edit.ts` (StudioEdits: open/commit/close, bản làm việc, base.json, read-back, pinned delta, áp delta), `studio/watch.ts` (watcher + `.sf/external.json`), graph `external_change`. Tool `studio.open|commit|close`, `frame.pinned_decide`; IPC tương ứng; desktop: nút Chỉnh/Lưu/Đóng trong tab xem trước.

## Technical Context
TS/Node 22, `parse5` 7 · Testing: unit `studio-diff.test.ts`; integration `studio-edit.test.ts` (Studio thật + proxy), `pinned-decide.test.ts`, `file-watch.test.ts`.

## Constitution Check
- [x] I · [x] II/III · [x] IV · [x] V (D9) · [x] VI (ghi qua WriteStore) · [x] VII · [x] VIII · [x] IX (proxy chỉ 127.0.0.1) · [x] X.

## Complexity Tracking
Thêm phụ thuộc `parse5` (so DOM đúng chuẩn HTML; D9 3.2 yêu cầu parse DOM).
