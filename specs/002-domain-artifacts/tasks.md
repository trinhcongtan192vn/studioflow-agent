# Tasks — 002 domain-artifacts

## Phase 1 — Hợp đồng (nền cho test)
- [x] T001 `scripts/gen-contracts.mjs`: trích khối TS D3 → `docs/contracts/domain/d3.ts`; bảng 7.2 → `config-keys.json` + `config-keys.ts`; `--check` (FR-001, FR-003, FR-013)
- [x] T002 `docs/contracts/domain/markdown.ts` front matter theo D3 5.2–5.6, 5.15 (FR-001)
- [x] T003 Sinh schema bằng ts-json-schema-generator + hậu xử lý pattern ID (FR-001, FR-005)
- [x] T004 Sinh `errors.json` từ bảng D3–D11 + `errors.local.json` (FR-002)
- [x] T005 Thêm bước `contracts --check` vào `scripts/verify.mjs`; test script cho generator (FR-003, US7 AC1)

## Phase 2 — Test fail-trước
- [x] T010 contract `tests/contract/domain-schemas.test.ts`: mỗi artifact có mẫu hợp lệ (pass) + không hợp lệ (E_SCHEMA_INVALID có path) (US3 AC1–2, SC-001)
- [x] T011 contract `tests/contract/errors-registry.test.ts`: mọi `E_*` trong `src/` có trong `errors.json`; mã trùng nguồn gộp một mục (US7 AC2–3, FR-002)
- [x] T012 contract `tests/contract/d3-sync.test.ts`: mọi interface trong khối TS D3 có trong `d3.ts`; mọi khóa bảng 7.2 có trong `config-keys.json` (FR-001)
- [x] T013 integration `tests/integration/channel-video.test.ts`: detect/init kênh, tạo 3 video (US1, US2, FR-011/012)
- [x] T014 integration `tests/integration/writer.test.ts`: ghi hợp lệ, sai schema, `..`/tuyệt đối/junction → E_PATH_OUTSIDE, sao lưu khi đã duyệt + giữ 20 bản, nhật ký (US5, FR-016..018)
- [x] T015 integration `tests/integration/atomic-kill.test.ts` (US5 AC5, SC-003)
- [x] T016 integration `tests/integration/migrate.test.ts`: migration giả 1→2, dry-run, too new (US6, FR-020)
- [x] T017 integration `tests/integration/domain-cli.test.ts`: `sf artifact validate|migrate`, `sf config resolve` (FR-021)
- [x] T018 unit `tests/unit/markdown-script.test.ts`, `markdown-storyboard.test.ts`: round-trip byte, gán ID, E_PARSE_MARKER có dòng, CRLF, Unicode thuộc tính (US3 AC3–5, FR-006/007)
- [x] T019 unit `tests/unit/crossref.test.ts` (US3 AC6, FR-009)
- [x] T020 unit `tests/unit/config-resolve.test.ts` (US4, FR-013/014/015)
- [x] T021 unit `tests/unit/ids-hash.test.ts` (FR-004, FR-010)
- [x] T022 unit `tests/unit/no-direct-writes.test.ts`: quét `src/` cấm `writeFile|rename|rm|unlink|mkdir|copyFile|appendFile` ngoài `src/store` (FR-019)

## Phase 3 — Code
- [x] T030 `src/contracts.ts`, `src/domain/{ids,hash,errors,artifacts}.ts`
- [x] T031 `src/domain/markdown/*` (lines, frontmatter, script, storyboard, blocks cho CAST/STORY/BRIEF/publish/frame.md)
- [x] T032 `src/domain/validate.ts`, `crossref.ts`
- [x] T033 `src/store/{paths,backup,writer}.ts`
- [x] T034 `src/config/{keys,defaults,resolve}.ts` + `setConfig`
- [x] T035 `src/domain/{channel,video}.ts` + `templates/channel/`
- [x] T036 `src/domain/migrate.ts`
- [x] T037 `src/modules/artifact/cli.ts`, `src/modules/config/cli.ts`; `details` trong lỗi CLI
- [x] T038 Xuất API công khai trong `src/index.ts`; fixtures kênh mẫu

## Phase 4 — Nghiệm thu
- [x] T040 `npm run verify` xanh; kill test 1 000 vòng đạt (93,6 s); độ phủ dòng core 93% (không tính file sinh)
