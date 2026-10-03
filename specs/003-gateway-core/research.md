# Research — 003 gateway-core

## R1. MCP SDK
- **Decision**: `@modelcontextprotocol/sdk` — `Server` thấp tầng với handler `tools/list`, `tools/call` dùng JSON Schema trực tiếp (không zod); HTTP bằng `StreamableHTTPServerTransport` chế độ stateless (mỗi request một transport), `node:http` bind `127.0.0.1:0`, kiểm `Authorization: Bearer` trước khi chuyển cho transport.
- **Rationale**: schema đầu vào đã là JSON Schema (Ajv); bản trong tiến trình trả `McpServer` để 005 gắn vào Claude Agent SDK (`{type:'sdk', name:'sf', instance}`).
- **Alternatives**: `McpServer.tool()` + zod (định nghĩa schema lần hai — trái Điều V).

## R2. Bảng chính sách là một nguồn
- **Decision**: `gateway/policy.ts` chép bảng D5 mục 4 dưới dạng mẫu tên tool → loại phiên; registry tra bảng, tool không có dòng nào → chỉ `main` và log cảnh báo. Test contract so từng ô.

## R3. Hỏi người dùng
- **Decision**: `PermissionBus` (EventEmitter) trong `core`; `request()` trả Promise; timeout mặc định 10 phút (tech-defaults mục 3), cấu hình được cho test. "Luôn cho phép" chỉ cho `batch_gen`/`paid_api` → ghi `policy.auto_approve.*` qua `setConfig` (002).

## R4. `script.run`
- **Decision**: bảng cho phép theo D5 mục 5.2; `sf` chạy bằng `process.execPath <core>/bin/sf.mjs`; `hyperframes` tra đường dẫn ghim (011 cung cấp qua `setExecutable`), thiếu → `E_SCRIPT_NOT_FOUND` (mã mới trong `errors.local.json`). Env tối thiểu: `SystemRoot, windir, TEMP, TMP, APPDATA, LOCALAPPDATA, PATH=<thư mục node>;%SystemRoot%\System32`, `HTTP(S)_PROXY=http://127.0.0.1:9` (cổng discard → từ chối kết nối) `[chờ S8]`, `NO_PROXY=` rỗng. Giới hạn 10 phút / 1 MB (tech-defaults mục 3).
- **Đồng bộ ở 003**: trả `{exit_code, stdout, stderr, truncated, timed_out}` trực tiếp; 004 chuyển thành job giữ nguyên `data`.

## R5. Hợp đồng D4
- **Decision**: mở rộng `gen-contracts.mjs` trích khối TS D4 mục 2.2–2.3 → `docs/contracts/gateway/d4.ts` (import type từ d3). Capability contracts D4 mục 3 sẽ trích khi tính năng capability đầu tiên cần (006).

## R6. Logger
- **Decision**: `src/log.ts` ghi JSON một dòng; sink mặc định: bỏ qua trừ khi `SF_LOG` đặt (stderr) hoặc `setLogSink()` (015 gắn file). `maskSecrets` che `sk-ant-…`, `sk-…`, `Bearer …`, `AIza…`.
