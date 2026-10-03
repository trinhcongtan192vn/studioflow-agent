# Tasks — 004

## Phase 1 — Hợp đồng
- [x] T001 Generator trích D4 mục 3, 4.1, 5 và D6 → `docs/contracts/gateway/d4.ts`, `workflow/d6.ts`; schema `WorkflowManifest`, `ProviderManifest` (FR-008)

## Phase 2 — Test fail-trước
- [x] T010 integration `tests/integration/jobs.test.ts`: tiến độ + sự kiện, thử lại, hủy, job con partial, khôi phục, thứ tự chọn (US1, FR-001..007, SC-003)
- [x] T011 integration `tests/integration/capability.test.ts`: cache trúng/trượt, provenance, không cache text/render, định tuyến + dự phòng, dọn LRU (US2, FR-008..012, SC-002)
- [x] T012 integration `tests/integration/graph.test.ts`: missing → build → fresh; sửa text/pause; builder lỗi; hỏi batch (US3, FR-013..017, SC-001)
- [x] T013 unit `tests/unit/timing.test.ts`: frame_timing + audio_meta (US4)
- [x] T014 integration `tests/integration/graph-job-cli.test.ts`: tool + CLI (US5, FR-018)

## Phase 3 — Code
- [x] T020 `db.ts`; lọc ExperimentalWarning
- [x] T021 `jobs/queue.ts`, `jobs/tools.ts`
- [x] T022 `WriteStore.copyWithin`, `WriteStore.removeDerived`
- [x] T023 `capability/registry.ts`, `capability/run.ts`, `cache/cache.ts`
- [x] T024 `graph/*`
- [x] T025 `modules/graph/cli.ts`, `modules/job/cli.ts`; đăng ký tool; export

## Phase 4 — Nghiệm thu
- [x] T030 `npm run verify` xanh
