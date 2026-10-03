# Research — 015

## R1. OTel tối thiểu
- `BasicTracerProvider` + `SimpleSpanProcessor` + exporter tự viết ghi đồng bộ `node:sqlite` (span ít, local) — không cần OTLP. `AsyncLocalStorageContextManager` để span lồng qua `await`.
- Nhiều `createCore` trong một tiến trình (test, CLI): provider toàn cục một lần, exporter ghi tới mọi DB đang gắn.
- Job chạy tách khỏi ngữ cảnh tool: lưu `traceparent` lúc `enqueue` (bộ nhớ), `sf.job` mở dưới ngữ cảnh đó khi chạy.

## R2. Phiên Agent SDK
- `sf.agent.session` mở thủ công quanh `query()`; `query` gọi trong `context.with` để callback tool MCP trong tiến trình kế thừa ngữ cảnh → `sf.tool` là con. `TRACEPARENT` đặt vào env tiến trình SDK. Token cộng từ sự kiện `usage`. OpenInference cho span LLM `[chờ S13]`.

## R3. Nội dung
- `sf.text.call` ghi `input.value`/`output.value` (quy ước OpenInference, cắt 20 000 ký tự) khi `settings.trace.capture_content` (mặc định true); mọi thuộc tính qua `maskSecrets`.
