# Implementation Plan: Job, cache, provenance, build graph cơ bản

**Branch**: `004-job-cache-provenance-graph-basic` | **Date**: 2026-10-03 | **Spec**: [spec.md](spec.md)

## Summary

`packages/core/src/`: `db.ts` (SQLite `node:sqlite`, bảng `jobs`, `cache_entries`), `jobs/` (hàng đợi bền, chọn theo ưu tiên/engine, thử lại, hủy, job con, khôi phục), `capability/` (registry provider + định tuyến D4 4.4, `runCapability` với cache + provenance), `cache/` (khóa, lưu đối tượng qua module ghi, LRU), `graph/` (6 loại nút, hash đầu vào, trạng thái, lan truyền, kế hoạch theo pha, build bằng job, builder `audio_meta`, `frame_timing`), tool Gateway `job.*`/`graph.*`, CLI. Hợp đồng `JobInfo`, `ProviderManifest`, capability, `WorkflowManifest` đã trích từ D4/D6 vào `docs/contracts/` (generator mở rộng).

## Technical Context

**Language/Version**: TypeScript 5 / Node 22 · **Primary Dependencies**: `node:sqlite` (không native addon) · **Storage**: `<app-data>/studioflow.db`, `<channel>/cache/objects`, `<video>/.sf/graph.json`, `provenance/` · **Testing**: Vitest với SQLite thật (file tạm), adapter/builder giả (Điều X: chỉ giả LLM/GPU) · **Target**: Windows 11 x64 · **Constraints**: không ghi ngoài module ghi; job khôi phục được.

## Constitution Check

- [x] **I** không `[NEEDS CLARIFICATION]` · [x] **II/III** trong `core`, CLI `sf graph`, `sf job` · [x] **IV** tasks liệt kê test trước · [x] **V** `JobInfo`, `ProviderManifest`, `Provenance`, `AudioMeta` từ `docs/contracts` · [x] **VI** đầu ra capability, cache, `graph.json`, provenance đều qua `WriteStore`; xóa cache bằng API dọn dẫn xuất của `WriteStore` (chỉ `cache/`, `.sf/`) · [x] **VII** provenance mọi đầu ra; log job; span ở 015 · [x] **VIII** không project mới · [x] **IX** adapter chỉ ở ranh giới provider (D4 4.2) · [x] **X** SQLite/FS thật; provider giả chỉ cho GPU/LLM.

## Project Structure

```text
packages/core/src/
├── db.ts
├── jobs/ queue.ts tools.ts
├── capability/ registry.ts run.ts
├── cache/ cache.ts
├── graph/ nodes.ts inputs.ts timing.ts audio-meta.ts graph.ts tools.ts
└── modules/ graph/cli.ts job/cli.ts
```

## Complexity Tracking

| Điểm | Lý do | Phương án đơn giản hơn bị loại vì |
|---|---|---|
| `node:sqlite` thay `better-sqlite3` (tech-defaults) | Không cần build native cho Node lẫn Electron (ABI khác nhau), đơn giản hóa đóng gói | `better-sqlite3` cần `electron-rebuild` và bản prebuilt khớp ABI |
