# Tasks — 001 repo-scaffold

Thứ tự: setup → test fail-trước → code. `[P]` = song song được. Mỗi task ghi FR/AC.

## Phase 1 — Setup
- [x] T001 Root `package.json` (workspaces), `tsconfig.base.json`, `.editorconfig`, `.gitattributes`, `.gitignore` bổ sung (FR-SC-001, FR-SC-007)
- [x] T002 [P] `scripts/doctor.mjs` + `npm run setup` (FR-SC-006)
- [x] T003 [P] ESLint flat config + Prettier ở gốc; ruff trong `workers/gpu/pyproject.toml` (FR-SC-005)
- [x] T004 [P] Skeleton `packages/core` (package.json exports, tsconfig, vitest config + coverage 80%) (FR-SC-003, FR-SC-015)
- [x] T005 [P] Skeleton `workers/gpu` (uv project, conftest gpu marker) (FR-SC-003, FR-SC-013)
- [x] T006 [P] Skeleton `apps/desktop` (electron-vite, React, electron-builder.yml) (FR-SC-003)

## Phase 2 — Test fail-trước
- [x] T010 contract `packages/core/tests/contract/cli-convention.test.ts`: spawn `sf` — `--version`, `--help`, `diag echo` (args + stdin `--json`), thiếu tham số → 2, `diag fail` → 1, stdin JSON hỏng → 2 (US2 AC1–4, FR-SC-008/009, SC-003)
- [x] T011 integration `packages/core/tests/integration/cli-registry.test.ts`: module giả trong thư mục tạm được phát hiện, xuất hiện ở `--help`; hai module trùng lệnh → `E_CLI_DUPLICATE_COMMAND` (US2 AC5, FR-SC-010)
- [x] T012 integration `packages/core/tests/integration/path-spaces.test.ts`: chạy `sf` với cwd chứa khoảng trắng + Unicode (FR-SC-007)
- [x] T013 [P] e2e `packages/core/tests/e2e/sample.e2e.test.ts` mẫu; gpu `tests/gpu/sample.gpu.test.ts` dùng `describeGpu` (FR-SC-012/013)
- [x] T014 [P] unit `packages/core/tests/unit/llm-replay.test.ts`: replay thiếu bản ghi → `E_LLM_FIXTURE_MISSING`; record ghi rồi replay đọc (US5 AC3, FR-SC-013)
- [x] T015 [P] Python: `tests/contract/test_selftest_json.py` (JSON + exit 0 không GPU), `tests/gpu/test_cuda.py` marker gpu, `tests/unit/test_detect.py` (US3 AC3)
- [x] T016 [P] desktop: `tests/unit/version-label.test.ts`, `tests/ui/window.ui.test.ts` (Playwright Electron: cửa sổ hiện phiên bản core) (US3 AC2)
- [x] T017 [P] `scripts/tests/*.test.mjs` (chạy bằng `node --test`): check-structure phát hiện project thứ 4; check-commit-msg chấp nhận/từ chối; verify báo lỗi project hỏng (US1 AC2, US3 AC1, US6, FR-SC-002/019)
- [x] T018 Lint rule: fixture desktop import `@studioflow/core/src/...` → ESLint lỗi (US3 AC4, FR-SC-002b)

## Phase 3 — Code
- [x] T020 core: `version.ts`, `index.ts` (getVersion) (FR-SC-011)
- [x] T021 core CLI: `cli/errors.ts`, `cli/registry.ts` (quét modules, phát hiện trùng), `cli/io.ts` (stdin ≤ 1 MB), `cli/main.ts`, `bin/sf.mjs` (FR-SC-008..011)
- [x] T022 core `modules/diag/cli.ts` (echo/fail) và `modules/test/cli.ts` (`sf test <type>`) (FR-SC-009, FR-SC-012)
- [x] T023 core `testing/gpu.ts`, `testing/llm-replay.ts` (FR-SC-013)
- [x] T024 worker `sf_worker` selftest (US3 AC3)
- [x] T025 desktop main/preload/renderer hiển thị phiên bản core (US3 AC2)
- [x] T026 `scripts/check-structure.mjs`, `scripts/check-commit-msg.mjs`, `.githooks/commit-msg` (FR-SC-002, FR-SC-019)
- [x] T027 `scripts/verify.mjs` + `verify-report.json` (FR-SC-004, US1)
- [x] T028 `scripts/package.mjs` + electron-builder NSIS (FR-SC-016/017, US4)
- [x] T029 `.github/workflows/ci.yml` (Windows, SF_GPU=0, SF_LLM=replay, commit check) (FR-SC-014)
- [x] T030 `extensions/README.md`; root README cập nhật lệnh (FR-SC-001, FR-SC-020)

## Phase 4 — Nghiệm thu
- [x] T040 `npm run verify` xanh 3 lần liên tiếp (SC-002); `npm run package` sinh bản cài, bản unpacked mở cửa sổ hiện phiên bản (Playwright). **Còn lại cho Tan:** cài/gỡ trên máy Windows 11 sạch (SC-004, US4 AC2–3).
