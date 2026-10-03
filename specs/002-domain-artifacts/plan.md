# Implementation Plan: Domain & Artifacts

**Branch**: `002-domain-artifacts` | **Date**: 2026-10-03 | **Spec**: [spec.md](spec.md)

## Summary

Sinh hợp đồng máy kiểm được từ D3 (`scripts/gen-contracts.mjs`: trích khối TS của D3 mục 3–7 → `docs/contracts/domain/d3.ts`; bảng khóa 7.2 → `config-keys.json` + type `ConfigKey`; JSON Schema bằng `ts-json-schema-generator`; bảng mã lỗi D3–D11 → `errors.json`). Thư viện miền trong `packages/core/src/domain` (ID, parse/serialize Markdown có khối dữ liệu, kiểm schema bằng Ajv, kiểm chéo, kênh/video), cấu hình theo tầng `src/config`, module ghi `src/store` (nguyên tử, nhật ký, sao lưu, chặn ra ngoài), khung migration và 3 lệnh CLI.

## Technical Context

**Language/Version**: TypeScript 5 / Node 22 (core)

**Primary Dependencies**: `ajv` 8 + `ajv-formats` (validate), `yaml` 2 (front matter/khối YAML), `ts-json-schema-generator` (dev, sinh schema)

**Storage**: file trong kênh/video (D3 mục 1); nhật ký ghi trong bộ nhớ của `WriteStore`

**Testing**: Vitest — contract (schema + mẫu), integration (FS thật, kill test), unit (parser, ID, config)

**Target Platform**: Windows 11 x64

**Project Type**: thư viện trong `packages/core` + CLI

**Performance Goals**: parse/validate `SCRIPT.md` 500 line < 100 ms

**Constraints**: ghi nguyên tử trên NTFS; round-trip byte-đồng nhất; không phụ thuộc mạng

**Scale/Scope**: ~20 loại artifact, ~45 khóa cấu hình, ~45 mã lỗi

## Constitution Check

- [x] **Spec (I):** không còn `[NEEDS CLARIFICATION]`.
- [x] **Thư viện + CLI (II, III):** toàn bộ ở `packages/core`; CLI `sf artifact validate|migrate`, `sf config resolve`.
- [x] **Test trước (IV):** tasks.md liệt kê test fail-trước cho từng AC.
- [x] **Hợp đồng (V):** type trích trực tiếp từ khối TS của D3; schema sinh từ type; `errors.json` sinh từ bảng D3–D11; kiểm đồng bộ trong `verify`.
- [x] **An toàn file (VI):** `src/store/writer.ts` là đường ghi duy nhất; test tĩnh cấm API ghi của `fs` ngoài `src/store` (FR-019).
- [x] **Quan sát (VII):** nhật ký ghi `(path, hash, by, ts)`; schema provenance (ghi provenance thuộc capability, 004+).
- [x] **Đơn giản (VIII):** không thêm project; generator là script gốc.
- [x] **Trừu tượng (IX):** Ajv/yaml dùng trực tiếp; không lớp repository.
- [x] **Tích hợp (X):** test với file system thật, kill test với tiến trình thật.

## Project Structure

```text
docs/contracts/
├── README.md
├── domain/
│   ├── d3.ts                  # GENERATED: khối TS D3 mục 3–7
│   ├── markdown.ts            # front matter/khối Markdown (D3 5.2–5.6, 5.15)
│   ├── config-keys.ts         # GENERATED: type ConfigKey
│   ├── config-keys.json       # GENERATED: khóa → kiểu, tầng
│   └── schemas/*.schema.json  # GENERATED: mỗi artifact
├── errors.json                # GENERATED: D3–D11 + errors.local.json
└── errors.local.json          # mã ngoài bảng D3–D11 (khung CLI 001, …) kèm spec nguồn
scripts/gen-contracts.mjs      # --check: báo lệch, không ghi
packages/core/src/
├── contracts.ts               # type + schema từ docs/contracts (một nguồn)
├── domain/ ids.ts hash.ts errors.ts artifacts.ts validate.ts crossref.ts channel.ts video.ts migrate.ts
│   └── markdown/ lines.ts frontmatter.ts script.ts storyboard.ts blocks.ts
├── config/ keys.ts defaults.ts resolve.ts
├── store/ writer.ts paths.ts backup.ts
└── modules/ artifact/cli.ts config/cli.ts
packages/core/templates/channel/      # profile/ mẫu khi khởi tạo kênh
packages/core/tests/fixtures/domain/  # kênh mẫu + mẫu hợp lệ/không hợp lệ
```

**Structure Decision**: `core` import hợp đồng từ `docs/contracts` (JSON import + `import type`), không chép.

## Complexity Tracking

| Điểm | Lý do | Phương án đơn giản hơn bị loại vì |
|---|---|---|
| Module ghi (Gateway) dựng ở 002 thay vì 003 | Migration, khởi tạo kênh, tạo video (FR-WS-01/03/05) phải ghi file; Điều VI cấm ghi ngoài module ghi | Ghi trực tiếp rồi chuyển sang 003 → vi phạm Điều VI tạm thời và phải viết lại |
