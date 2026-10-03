# Implementation Plan: Model manager

**Branch**: `014-model-manager-install` | **Spec**: [spec.md](spec.md)

## Summary
`extensions/providers/models.yaml`; `packages/core/src/store/download.ts` (tải/giải nén/ghi app-data — thuộc module ghi), `src/models/install.ts` (danh mục, trạng thái, kế hoạch, cài, `settings.installed`, PATH công cụ), `src/secrets/credman.ts` (Credential Manager), job `download` trong `createCore`, CLI `model`, `secret`. `text.*` đọc khóa qua `getSecretDefault`.

## Constitution Check
- [x] I · [x] II/III · [x] IV · [x] V (`SettingsConfig` D3) · [x] VI (mọi ghi file nằm trong `src/store`) · [x] VII · [x] VIII · [x] IX · [x] X (tải thật qua máy chủ HTTP cục bộ; Credential Manager thật).

## Complexity Tracking
Không có vi phạm.
