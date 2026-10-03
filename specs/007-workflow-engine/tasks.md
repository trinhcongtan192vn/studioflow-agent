# Tasks — 007

## Phase 1 — Fixture
- [x] T001 Gói fixture `demo-explainer` (design?, script(agent), storyboard(agent, approval), voice(engine), finalize gate graph_fresh) + gói lỗi thứ tự

## Phase 2 — Test fail-trước
- [x] T010 unit `tests/unit/semver.test.ts`, `workflow-library.test.ts` (validateManifest: trùng id, after lạ, vòng, E_STEP_ORDER)
- [x] T011 contract `tests/contract/workflow-contract.test.ts`: fixture hợp lệ schema; `VideoStateSummary` đúng hình dạng; policy tool workflow.*
- [x] T012 integration `tests/integration/workflow-engine.test.ts`: briefing→select→approve brief; chạy agent/engine step; gate fail; approval; changes_requested; rewind; run_to/pause; approval invalidation; skip_if; executor thiếu
- [x] T013 integration `tests/integration/workflow-recovery.test.ts`: kill tiến trình giữa bước engine → mở lại hoàn tất (SC-002)
- [x] T014 integration `tests/integration/workflow-tools-cli.test.ts`: tool qua Gateway, `sf ext validate`, `sf workflow list|state`

## Phase 3 — Code
- [x] T020 `workflow/semver.ts`, `library.ts`, `packs.ts`
- [x] T021 `workflow/gates.ts`, `engine.ts`, `service.ts`
- [x] T022 `workflow/tools.ts`; gắn `createCore`; executor `voice`
- [x] T023 CLI `ext`, `workflow`

## Phase 4 — Nghiệm thu
- [x] T030 `npm run verify` xanh
