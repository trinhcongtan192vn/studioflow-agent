# Research — 028

## R1. Usage từ span
Ghi `usage` trong exporter span (cùng sự kiện tạo trace) → báo cáo khớp trace theo cấu trúc (AC-M3-04). Bước/video của span con lấy từ bảng span đang mở (processor `onStart`), vì span cha kết thúc sau con. Thêm cột `span_id`, `trace_id` ngoài D11 để đối chiếu.

## R2. Phoenix
Exporter `@opentelemetry/exporter-trace-otlp-http@0.222.0` (khớp SDK 2.11) qua `BatchSpanProcessor` bật/tắt lúc chạy. Server: dùng Phoenix sẵn có ở 6006, không có thì `phoenix serve` từ môi trường app (`models.yaml: phoenix-env`, `arize-phoenix==20.19.0`, profile `full`).

## R3. Ngữ cảnh từ Studio — WebMCP
- Studio 0.8.115 mở máy chủ WebMCP qua `postMessage` khi chạy trong iframe (`{channel:'mcp-iframe', type:'mcp', direction, payload}`, bắt tay `mcp-check-ready`/`mcp-server-ready`), tool `studio_frame` (mốc đầu phát), `studio_inspect` (phần tử đang chọn: `sourceFile`, `dataAttributes`…). Alt+click trong iframe khác origin không bắt được → dùng tool này.
- Polyfill chỉ đăng ký tool khi khung cha **cùng origin** (Chrome chưa có Permissions Policy `tools`) → proxy phục vụ `/__sf/bridge.html` cùng origin với Studio, nhúng Studio và chuyển tiếp thông điệp với app.
- Electron 138 đặt `originAgentCluster = false` cho mọi khung (header `Origin-Agent-Cluster` và cờ `OriginAgentClusterDefaultEnabled` không đổi được) → polyfill ném `SecurityError` → proxy chèn shim nhỏ vào trang ứng dụng Studio báo `originAgentCluster = true` (Studio cục bộ, sau proxy).
- Xem trước giờ cũng đi qua proxy ở chế độ chỉ đọc (chặn mọi API ghi trừ chọn/thăm dò) — chặt hơn 017.

## R4. Eval
`ReviewRound` (D3) không ghi phiên bản rubric → `rubric_version` lấy từ manifest workflow của video + `version` của rubric hiện tại (chỉ đúng khi rubric chưa đổi). "Bản phát hành" = bản `SCRIPT.md` hiện tại; bản duyệt tìm theo hash trong file hiện tại hoặc `.sf/backups`.
