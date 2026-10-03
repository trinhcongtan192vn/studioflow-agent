# Implementation Plan: Observability local

**Branch**: `015-observability-local` | **Spec**: [spec.md](spec.md)

## Summary
`@opentelemetry/api` 1.9.1, `sdk-trace-base`/`context-async-hooks`/`core` 2.11.0. `packages/core/src/trace/trace.ts` (provider, exporter SQLite, `withSpan`, `currentTraceparent`, truy vấn); bảng `spans` trong `studioflow.db`; instrument Gateway, `JobQueue`, `WorkflowEngine`, `runRefine`, `runCapability`, text service, `renderVideo`, `ClaudeSession`, `PythonWorker`; CLI `sf trace`.

## Constitution Check
- [x] I–X; VII (đây chính là quan sát); IX: không thêm lớp trừu tượng ngoài `withSpan`.

## Complexity Tracking
Không có vi phạm.
