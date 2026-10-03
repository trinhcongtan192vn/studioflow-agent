# Feature Specification: Quan sát cục bộ — trace SQLite

**Feature Branch**: `015-observability-local` · **Created**: 2026-10-04 · **Status**: Draft

**Input**: Backlog dòng 015: "trace SQLite, màn xem trace". **Phủ**: FR-OB-01. **Dựa trên**: D11 mục 1, 2, 5 · tech-defaults (OpenTelemetry API + exporter SQLite tự viết) · D3 mục 6.2 (`settings.trace`).

## User Scenarios & Testing
### US1 — Ghi trace (P1) — FR-OB-01
Span D11 mục 1.1 ghi vào bảng `spans` của `studioflow.db`: `sf.workflow.step`, `sf.refine.round`, `sf.agent.session`, `sf.tool`, `sf.job` (cha = tool/bước đã xếp job, qua `traceparent`), `sf.provider.run`, `sf.text.call` (gen_ai.*, nội dung khi `trace.capture_content`), `sf.render`. `TRACEPARENT` truyền xuống Agent SDK, `traceparent` xuống worker JSON-RPC. Khóa bí mật bị che. Giữ `trace.retention_days` ngày. Lỗi ghi span không chặn việc chính (`E_TRACE_STORE`).
### US2 — Xem trace (P1)
`listTraces`/`getTrace` (cây span có độ sâu) + CLI `sf trace list [--video] [--limit]`, `sf trace show <trace_id>`. Màn xem trace trong app (UI) dùng cùng API, gắn ở 008 (vỏ desktop) — 015 chưa có vỏ UI.

## Requirements
- **FR-001** provider OTel toàn cục + AsyncLocalStorage + W3C propagator; exporter SQLite nhiều đích (mỗi `createCore`).
- **FR-002** span tại Gateway, job queue, engine, refine, capability, text, render, phiên Claude; worker nhận `traceparent`.
- **FR-003** truy vấn + CLI.

## Success Criteria
- **SC-001** Một lời gọi `tts.synthesize` cho cây `sf.tool → sf.job → sf.provider.run` cùng trace. **SC-002** phiên agent có span với token và `TRACEPARENT` cùng trace.

## Ngoài phạm vi
OpenInference instrumentation cho Agent SDK (`[chờ S13]`), Phoenix (028), bảng `usage`/báo cáo chi phí (028).
