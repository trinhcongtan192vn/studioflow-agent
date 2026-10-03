# Data model — 003

Dùng nguyên văn: `SessionContext`, `ToolResult` (D4 mục 2.2–2.3 → `docs/contracts/gateway/d4.ts`).

| Thực thể | Trường |
|---|---|
| `ToolDefinition` | `name` (`nhóm.tên`), `description`, `input` (JSON Schema), `handler(input, ctx) → Promise<data>` |
| `ToolContext` | `session: SessionContext`, `store: WriteStore`, `permissions: PermissionBus`, `videoRel?` |
| `PermissionRequest` | `request_id`, `session_id`, `tool`, `kind: overwrite_approved \| pinned_frame \| batch_gen \| paid_api \| render`, `summary`, `estimate?` |
| `PermissionDecision` | `request_id`, `allow: boolean`, `always?: boolean` (chỉ batch_gen/paid_api) |
| `ScriptResult` | `exit_code`, `stdout`, `stderr`, `truncated`, `timed_out` |
| `ToolCallLog` | `tool`, `session_id`, `kind`, `ok`, `code?`, `ms` |
