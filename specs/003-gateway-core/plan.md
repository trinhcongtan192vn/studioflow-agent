# Implementation Plan: Gateway Core

**Branch**: `003-gateway-core` | **Date**: 2026-10-03 | **Spec**: [spec.md](spec.md)

## Summary

`packages/core/src/gateway/`: registry tool + bảng chính sách D5 mục 4 (một nguồn), kiểm đầu vào bằng Ajv, `ToolResult` với `retryable` từ `errors.json`, bus xác nhận, tool nền (`artifact.*`, `config.*`, `script.run`) dựng trên module ghi/miền của 002, MCP server `sf` (trong tiến trình + Streamable HTTP 127.0.0.1 có Bearer) bằng `@modelcontextprotocol/sdk`, logger JSON che khóa. Hợp đồng `SessionContext`/`ToolResult` được trích từ D4 mục 2.2–2.3 vào `docs/contracts/` (mở rộng generator).

## Technical Context

**Language/Version**: TypeScript 5 / Node 22
**Primary Dependencies**: `@modelcontextprotocol/sdk` 1.x (Server thấp tầng + `StreamableHTTPServerTransport` stateless), Ajv (002), `yaml` (002)
**Storage**: file kênh/video qua `WriteStore`; quyết định "luôn cho phép" trong `state.json.config_overrides`
**Testing**: Vitest — contract (bảng chính sách, ToolResult, MCP qua HTTP), integration (FS thật, `script.run` tiến trình thật, 20 lời gọi đối nghịch), unit (glob, arg check, masking)
**Target Platform**: Windows 11 x64
**Project Type**: thư viện trong `packages/core` + CLI
**Performance Goals**: overhead chính sách < 5 ms mỗi lời gọi tool
**Constraints**: HTTP chỉ bind 127.0.0.1; không shell; env tối thiểu
**Scale/Scope**: 7 tool nền, ~25 tool được khai báo trong bảng chính sách cho các tính năng sau

## Constitution Check

- [x] **Spec (I):** không còn `[NEEDS CLARIFICATION]`.
- [x] **Thư viện + CLI (II, III):** `packages/core/src/gateway`; CLI `sf gateway serve|tools`.
- [x] **Test trước (IV):** tasks.md liệt kê test fail-trước theo AC.
- [x] **Hợp đồng (V):** `SessionContext`, `ToolResult` trích tự động từ D4 mục 2.2–2.3; không định nghĩa lại.
- [x] **An toàn file (VI):** mọi ghi qua `WriteStore`; Gateway thêm phạm vi phiên, owner, base_hash, hỏi người dùng.
- [x] **Quan sát (VII):** log JSON mỗi lời gọi tool; span trace thuộc 015 (điểm móc `onToolCall`).
- [x] **Đơn giản (VIII):** không thêm project.
- [x] **Trừu tượng (IX):** MCP SDK dùng trực tiếp; Gateway là ranh giới đã định (D4).
- [x] **Tích hợp (X):** MCP client thật qua HTTP; `script.run` chạy tiến trình thật.

## Project Structure

```text
docs/contracts/gateway/d4.ts               # GENERATED: D4 mục 2.2–2.3
packages/core/src/
├── log.ts                                  # logger JSON + maskSecrets
└── gateway/
    ├── types.ts        # ToolDefinition, ToolContext, PermissionKind
    ├── policy.ts       # bảng D5 mục 4 → loại phiên được phép theo tool
    ├── registry.ts     # đăng ký, kiểm, gọi, ánh xạ lỗi → ToolResult
    ├── session.ts      # đường dẫn theo phiên, owner, file cảnh, allowed_paths
    ├── permission.ts   # PermissionBus (permission.requested / decide, timeout, always-allow)
    ├── glob.ts
    ├── tools/ artifact.ts config.ts script.ts index.ts
    ├── mcp.ts          # MCP server trong tiến trình
    └── http.ts         # Streamable HTTP 127.0.0.1 + Bearer
packages/core/src/modules/gateway/cli.ts    # sf gateway serve|tools
```

**Structure Decision**: Gateway là module trong `core` (Điều II); tool của tính năng sau đăng ký qua `registry.register()`.

## Complexity Tracking

Không có vi phạm.
