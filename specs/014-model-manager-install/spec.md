# Feature Specification: Trình quản lý model, hồ sơ cài đặt, kho bí mật

**Feature Branch**: `014-model-manager-install` · **Created**: 2026-10-04 · **Status**: Draft

**Input**: Backlog dòng 014: "tải model theo yêu cầu, hồ sơ cài đặt, onboarding, Credential Manager".

**Phủ yêu cầu**: FR-OP-04, FR-OP-07, AC-M1-06 (phần core; màn onboarding UI-01 gắn ở 008).

**Dựa trên `docs/`**: D4 mục 9.3 (môi trường Python mỗi engine), 10 (danh mục `models.yaml`, hồ sơ `minimal/standard/full`, job `download`, `E_DOWNLOAD_CHECKSUM`), 12 (`sf model install|list`) · D5 mục 5.4 (Credential Manager `StudioFlow/<provider>`) · D3 mục 6.2 (`settings.installed`) · D10 (khóa chỉ hiện 4 ký tự cuối, `secrets.set`) · FN-014 mục 1.

## User Scenarios & Testing *(mandatory)*
### US1 — Danh mục và kế hoạch cài (P1)
`extensions/providers/models.yaml` liệt kê thành phần (FFmpeg, uv, whisper.cpp, Whisper large-v3-turbo, OmniVoice, môi trường Python `omnivoice`, `audio-analysis`) với URL ghim + sha256 + kích thước; `installPlan(profile)` trả trạng thái từng thành phần (`installed` | `system` | `missing` | `partial`) và tổng dung lượng cần tải (báo trước khi tải).
### US2 — Tải (P1) — FR-OP-04
Job `download` cài một thành phần: tải file vào `.part`, tải tiếp bằng HTTP Range khi đứt, file chỉ xuất hiện ở đích khi khớp sha256 (`E_DOWNLOAD_CHECKSUM`), giải nén zip, file văn bản nhỏ (`refs/main` của cache Hugging Face); môi trường Python bằng uv. Ghi `settings.installed`.
### US3 — Kho bí mật (P1) — FR-OP-07
Khóa `openai`, `deepseek`, `anthropic` lưu Credential Manager tên `StudioFlow/<provider>`; đọc cho `text.*` (biến môi trường ưu tiên khi dev); chỉ hiện 4 ký tự cuối.
### US4 — CLI
`sf model list [--profile]`, `sf model install <key>|--profile <p>`, `sf secret set|delete|status`.

## Requirements
- **FR-001** danh mục + kiểm định dạng; **FR-002** `downloadFile` (Range, sha256, nguyên tử); **FR-003** `installEntry`/`installPlan`/`recordInstalled`; **FR-004** job `download`; **FR-005** Credential Manager (P/Invoke qua PowerShell, bí mật qua stdin); **FR-006** công cụ đã tải (FFmpeg, uv) vào PATH tiến trình; **FR-007** CLI.

## Success Criteria
- **SC-001** Máy tham chiếu: `sf model list --profile standard` báo mọi thành phần `installed`/`system`, 0 byte cần tải.
- **SC-002** Tải đứt giữa chừng tải tiếp đúng; sai checksum không để lại file đích (test với máy chủ HTTP cục bộ).
- **SC-003** Đặt/đọc/xóa khóa thật trong Credential Manager.

## Ngoài phạm vi
Màn onboarding (008), gỡ thành phần, ComfyUI/Qwen (018), dọn đĩa (024), cài trên máy sạch (Tan kiểm cùng 001 SC-004).
