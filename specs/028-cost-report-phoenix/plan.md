# Implementation Plan: Báo cáo chi phí, Phoenix, eval, ngữ cảnh từ xem trước

**Branch**: `028-cost-report-phoenix` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

## Summary
Core: bảng `usage` + ghi từ span (`trace/trace.ts`: `OpenSpanTracker`, `usageOf`), `trace/cost.ts` (báo cáo + CSV), `trace/phoenix.ts` + exporter OTLP bật/tắt, `eval/compare.ts` + CLI `sf eval compare`, `capability/run.ts` thêm `sf.gpu_ms/sf.cost_kind/sf.units`, IPC `cost.report`, `trace.phoenix`, `chat.send.context_refs`. Studio: proxy cho xem trước (chỉ đọc), trang cầu nối, shim agent cluster. Desktop: tab Chi phí, nút Phoenix, chip ngữ cảnh, `StudioBridge` (client WebMCP), nút đính kèm ở Xem trước và bảng caption.

## Technical Context
TS/Node 22, OTel SDK 2.11 + `exporter-trace-otlp-http` 0.222 · Testing: integration `cost-report.test.ts` (máy chủ OpenAI/OTLP giả), `studio-preview.test.ts`; desktop unit `context-refs.test.ts`; UI `workspace.ui.test.ts` (WebMCP thật trong Electron).

## Constitution Check
- [x] I · [x] II/III · [x] IV · [x] V (D11, D5, D10) · [x] VI · [x] VII · [x] VIII · [x] IX (proxy/Phoenix chỉ 127.0.0.1; xem trước chỉ đọc) · [x] X.

## Complexity Tracking
Thêm phụ thuộc `@opentelemetry/exporter-trace-otlp-http` (tech-defaults: OTLP HTTP sang Phoenix). Shim agent cluster trong trang Studio (R3).
