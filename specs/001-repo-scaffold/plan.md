# Implementation Plan: Repo Scaffold (khung monorepo)

**Branch**: `001-repo-scaffold` | **Date**: 2026-10-03 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-repo-scaffold/spec.md`

## Summary

Dựng khung monorepo 3 project (`apps/desktop`, `packages/core`, `workers/gpu`) bằng npm workspaces + một project Python dùng `uv`. Lõi cung cấp khung CLI `sf` (đăng ký lệnh theo module, quy ước JSON/stdout, `{code, message}`/stderr, mã thoát 0/1/2) và API công khai tối thiểu (`getVersion()`). Một script tổng `npm run verify` chạy build + lint + test cho cả ba project và in báo cáo theo project. Khung test theo D12 (thư mục theo loại, nhãn `gpu`, `SF_GPU`, `SF_LLM` record/replay), CI GitHub Actions trên Windows, kiểm tra cấu trúc/ranh giới, kiểm tra commit có `NNN`, và đóng gói NSIS bằng electron-builder (chỉ vỏ app + `core`, không ký số).

## Technical Context

**Language/Version**: TypeScript 5.x trên Node 22 (LTS); Python ≥ 3.11 (máy dev 3.12, CI 3.11)

**Primary Dependencies**: Electron + React 18 + electron-vite (desktop); không framework CLI — `node:util.parseArgs` (core); `uv` (Python)

**Storage**: N/A (chưa có dữ liệu ở 001)

**Testing**: Vitest (+ `@vitest/coverage-v8`) cho TS; pytest cho Python; Playwright for Electron cho `ui`

**Lint/format**: ESLint (flat config) + Prettier cho TS; ruff (lint + format) cho Python; `.editorconfig` + `.gitattributes` (LF) chống lệch CRLF

**Target Platform**: Windows 11 x64

**Project Type**: desktop-app + library/CLI + Python worker (monorepo)

**Performance Goals**: `npm run verify` ở trạng thái khung ≤ 5 phút trên máy dev; CI ≤ 10 phút (SC-005)

**Constraints**: Chạy được với đường dẫn có khoảng trắng/Unicode; không cần GPU; không gọi mạng trong test (`SF_LLM=replay`)

**Scale/Scope**: 3 project, ~20 file nguồn khung, test mẫu mỗi loại

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Spec (I):** không còn `[NEEDS CLARIFICATION]` (đã chốt 2026-10-03); mọi FR-SC kiểm được bằng test hoặc script.
- [x] **Thư viện + CLI (II, III):** khung CLI và `getVersion()` nằm trong `packages/core`; desktop chỉ gọi API công khai; worker có lệnh `selftest`.
- [x] **Test trước (IV):** danh sách test fail-trước theo AC ở `tasks.md`; thứ tự thư mục contract → integration → e2e → unit.
- [x] **Hợp đồng (V):** 001 chưa có schema miền (002 tạo `docs/contracts/`). Quy ước CLI lấy nguyên văn D4 mục 12; `contracts/cli.md` chỉ trích dẫn.
- [x] **An toàn file (VI):** 001 không ghi vào kênh/video/kho dữ liệu app. Script dev chỉ ghi `dist/`, `coverage/`, `release/`.
- [x] **Quan sát (VII):** chưa có thao tác sinh nội dung; log khung CLI ra stderr dạng JSON có cấu trúc khi `SF_LOG=debug`.
- [x] **Đơn giản (VIII):** đúng 3 project; script gốc (`scripts/*.mjs`) không phải project; có kiểm tra tự động (FR-SC-002).
- [x] **Trừu tượng (IX):** không thêm lớp bọc; CLI dùng `parseArgs` trực tiếp.
- [x] **Tích hợp (X):** test CLI spawn tiến trình thật, test worker chạy Python thật, test desktop chạy Electron thật (Playwright).

## Project Structure

### Documentation (this feature)

```text
specs/001-repo-scaffold/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── cli.md
│   └── verify-report.md
└── tasks.md
```

### Source Code (repository root)

```text
package.json              # npm workspaces: apps/desktop, packages/core
tsconfig.base.json
eslint.config.mjs  .prettierrc.json  .editorconfig  .gitattributes
.githooks/commit-msg      # gọi scripts/check-commit-msg.mjs
.github/workflows/ci.yml
scripts/
├── doctor.mjs            # kiểm công cụ nền tảng (FR-SC-006)
├── verify.mjs            # build + lint + test tổng, báo cáo theo project (FR-SC-004)
├── check-structure.mjs   # đúng 3 project, extensions/ không là project (FR-SC-002a)
├── check-commit-msg.mjs  # NNN trong commit/PR (FR-SC-019)
└── package.mjs           # verify xanh rồi mới electron-builder (FR-SC-016)
packages/core/
├── package.json          # name @studioflow/core, "exports" chỉ "." và "./cli"
├── bin/sf.mjs
├── src/
│   ├── index.ts          # API công khai: getVersion()
│   ├── version.ts
│   ├── cli/              # khung: registry, run, io, errors
│   ├── testing/          # helper test dùng chung: gpu, llm-replay
│   └── modules/
│       └── diag/cli.ts   # lệnh mẫu `sf diag echo` phủ 0/1/2
└── tests/{contract,integration,e2e,unit,gpu}/
apps/desktop/
├── package.json  electron.vite.config.ts  electron-builder.yml
├── src/main/index.ts  src/preload/index.ts  src/renderer/{index.html,main.tsx,App.tsx}
└── tests/{unit,ui}/
workers/gpu/
├── pyproject.toml  uv.lock
├── src/sf_worker/{__init__.py,__main__.py,selftest.py}
└── tests/{contract,integration,unit,gpu}/  conftest.py
extensions/README.md
```

**Structure Decision**: monorepo đúng 3 project theo constitution Điều VIII và `docs/README.md` mục 3.2. Script điều phối ở `scripts/` gốc, không phải project (không có `package.json` riêng).

## Complexity Tracking

Không có vi phạm.
