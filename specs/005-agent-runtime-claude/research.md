# Research — 005

## R1. Xác thực (thay `[chờ S8]` phần xác thực)
- **Kết quả thử 2026-10-03**: `query()` với `settingSources: []` dùng đăng nhập Claude Pro của máy (`apiKeySource: none`, `apiProvider: firstParty`); `accountInfo()` trả trong ~0,8 s với prompt dạng luồng chưa phát gì → `authStatus()` không tốn lượt.
- **Decision**: `method = 'claude-plan'` khi `accountInfo().apiProvider === 'firstParty'` và có `subscriptionType`; `'api-key'` khi dùng `ANTHROPIC_API_KEY` từ `getApiKey()`; còn lại `'none'`.

## R2. Môi trường tiến trình SDK
- **Decision**: env = env của `core` bỏ mọi biến `CLAUDECODE*`, `CLAUDE_CODE_*`, `CLAUDE_AGENT_SDK*`, `CLAUDE_PID`, `CLAUDE_EFFORT`, `AI_AGENT` (khi dev chạy bên trong Claude Code, các biến này làm tiến trình con hiểu nhầm ngữ cảnh) + `ANTHROPIC_API_KEY` nếu dùng khóa.

## R3. Gắn Gateway
- **Decision**: `mcpServers: { sf: { type: 'sdk', name: 'sf', instance: createMcpServer(gateway, context) } }` (003). Tên tool thấy trong SDK: `mcp__sf__<tên MCP>`.

## R4. Tiếp tục phiên
- **Decision**: mỗi `send()` là một `query()` với `resume: <sdk session id>` của lượt trước (phiên `main`); `SessionOptions.resume` khởi tạo id ban đầu.

## R5. Ghi/phát lại
- **Decision**: lớp `RecordReplayRuntime` bọc runtime thật, dùng `llmCall` (001) với khóa = `{kind, model, systemAppend, plugins: basename, allowed, history}`; bản ghi là mảng `AgentEvent`. Bản ghi không chứa đường dẫn tạm.
- Hệ quả: test ở `replay` kiểm luồng sự kiện, không kiểm tác dụng phụ của tool; test tác dụng phụ (SC-003) gắn `describeLive` và chạy ở `record` (D12 mục 4).

## R6. Quan sát từ phiên thật (2026-10-03)
- SDK nạp tool MCP theo kiểu trì hoãn: agent gọi `ToolSearch` (`select:mcp__sf__artifact_read`) trước khi dùng tool `sf`. `ToolSearch` là tool nội bộ chỉ đọc danh mục tool, không ghi/chạy lệnh/mạng; SDK không chuyển nó qua `canUseTool`. Giữ nguyên, không thêm vào bảng D5.
- Khi được yêu cầu dùng Bash/Write, agent trả lời không có công cụ đó và đề nghị ghi qua `mcp__sf__artifact_write` — không file nào được tạo (SC-003).
- Chi phí báo bởi SDK cho 2 phiên thử: 0,11 USD + 0,02 USD (gói Claude Pro, không tính tiền API).
