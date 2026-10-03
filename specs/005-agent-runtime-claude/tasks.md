# Tasks — 005

## Phase 1 — Hợp đồng
- [x] T001 Generator trích D5 mục 1 → `docs/contracts/agent/d5.ts` (FR-001)

## Phase 2 — Test fail-trước
- [x] T010 contract `tests/contract/agent-policy.test.ts`: allowed/disallowed theo kind, canUseTool (US2, FR-003/004, SC-001)
- [x] T011 unit `tests/unit/agent-events.test.ts`: ánh xạ thông điệp SDK → AgentEvent, mã lỗi (FR-006)
- [x] T012 unit `tests/unit/agent-options.test.ts`: tùy chọn SDK (settingSources, mcpServers, maxTurns, env sạch, plugins, systemPrompt) (US2 AC5, FR-002/005/009)
- [x] T013 integration `tests/integration/agent-replay.test.ts`: phát lại, thiếu bản ghi, khóa ổn định (US4, FR-008)
- [x] T014 integration live `tests/integration/agent-live.test.ts` (`describeLive`, SF_LLM=record): đọc artifact qua Gateway; yêu cầu dùng Bash/Write không tạo được file (US1, SC-003)
- [x] T015 integration `tests/integration/agent-cli.test.ts`: `sf agent auth|ask` ở replay (FR-010)

## Phase 3 — Code
- [x] T020 `agent/policy.ts`, `agent/system-append.ts`, `agent/events.ts`
- [x] T021 `agent/claude.ts`, `agent/replay.ts`, `agent/index.ts`
- [x] T022 `extensions/studioflow-core`
- [x] T023 `modules/agent/cli.ts`; export

## Phase 4 — Nghiệm thu
- [x] T030 Ghi bản ghi bằng `SF_LLM=record`; `npm run verify` xanh (replay)
