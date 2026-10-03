# Tasks — 003 gateway-core

## Phase 1 — Hợp đồng & phụ thuộc
- [x] T001 Mở rộng `gen-contracts.mjs`: D4 mục 2.2–2.3 → `docs/contracts/gateway/d4.ts`; mã `E_SCRIPT_NOT_FOUND` vào `errors.local.json` (FR-002, FR-017)
- [x] T002 Cài `@modelcontextprotocol/sdk`

## Phase 2 — Test fail-trước
- [x] T010 contract `tests/contract/gateway-policy.test.ts`: mọi ô D5 mục 4 với tool đã có; tool lạ chỉ `main` (US2 AC1, FR-004, SC-002)
- [x] T011 contract `tests/contract/gateway-mcp-http.test.ts`: MCP client thật, `tools/list` theo kind, tên `_`, 401, ToolResult lỗi (US5, FR-018/019, SC-003)
- [x] T012 integration `tests/integration/gateway-artifact.test.ts`: read/write/validate/list, gán ID, base_hash, schema, read_only_videos, owner, allowed_paths (US1, US2 AC2–4, FR-005..008, FR-012..015)
- [x] T013 integration `tests/integration/gateway-permission.test.ts`: ghi đè đã duyệt/frame ghim hỏi, đồng ý/từ chối/timeout, always-allow (US3, FR-009..011)
- [x] T014 integration `tests/integration/gateway-script.test.ts`: `sf` cho phép/chặn, lệnh ngoài danh sách, đối số nguy hiểm, timeout, env tối thiểu (US4, FR-017)
- [x] T015 integration `tests/integration/gateway-adversarial.test.ts`: 20 lời gọi đối nghịch (SC-001)
- [x] T016 unit `tests/unit/gateway-registry.test.ts`: tool giả đăng ký, retryable từ errors.json, E_INTERNAL, kiểm đầu vào (US6, FR-001..003)
- [x] T017 unit `tests/unit/log-mask.test.ts`, `glob.test.ts` (FR-021)
- [x] T018 integration `tests/integration/gateway-cli.test.ts`: `sf gateway tools`, `sf gateway serve` (FR-020)

## Phase 3 — Code
- [x] T020 `src/log.ts`
- [x] T021 `src/gateway/{types,policy,registry,session,permission,glob}.ts`
- [x] T022 `src/gateway/tools/{artifact,config,script,index}.ts`; `crossCheckVideo` nhận nội dung ghi đè
- [x] T023 `src/gateway/{mcp,http}.ts`
- [x] T024 `src/modules/gateway/cli.ts`; export API

## Phase 4 — Nghiệm thu
- [x] T030 `npm run verify` xanh; quickstart
