# Feature Specification: Agent Runtime Port + adapter Claude Agent SDK

**Feature Branch**: `005-agent-runtime-claude`

**Created**: 2026-10-03

**Status**: Draft

**Input**: Backlog dòng 005: "Agent Runtime Port + adapter Claude Agent SDK, plugin local".

**Phủ yêu cầu**: FR-CH-01, FR-CH-05 (lớp đầu: phiên chỉ thấy tool được phép; xác nhận đi qua bus của 003), FR-CH-06 (runtime không có tool ghi/lệnh/mạng riêng), NFR-07 (xác thực không ghi ra file), NFR-08 (thay runtime chỉ cần adapter).

**Dựa trên `docs/`**: D5 mục 1–6 · D4 mục 2.1–2.2 (MCP `sf`, `SessionContext`) · tech-defaults mục 2 (ánh xạ SDK, `maxTurns`) · FN-005 (văn bản `systemAppend`) · D12 mục 2 (LLM ghi/phát lại), mục 4 (đổi runtime → e2e với LLM `record`).

## Bối cảnh & mục tiêu

Mọi phần của app nói chuyện với agent qua `AgentRuntime` (D5 mục 1). Bản đầu dùng Claude Agent SDK: phiên không nạp cấu hình người dùng, chỉ nạp plugin app chỉ định, chỉ có MCP server `sf` (Gateway 003) gắn `SessionContext`, tắt tool ghi/lệnh/mạng có sẵn, có `canUseTool` làm lớp chính sách đầu. Kiểm thử chạy được không mạng nhờ ghi/phát lại sự kiện agent.

**Đã xác minh (2026-10-03, thay `[chờ S8]` phần xác thực)**: SDK 0.3.288 dùng được đăng nhập gói Claude của người dùng (Claude Pro, `apiProvider: firstParty`) mà không cần khóa API; `accountInfo()` trả thông tin tài khoản không cần gửi prompt; model mặc định `claude-sonnet-5-5`.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Mở phiên và trò chuyện trong ngữ cảnh video (Priority: P1)

Mở phiên `main` cho một video → gửi tin nhắn → nhận luồng `AgentEvent` (`text_delta`, `tool_call`, `tool_result`, `usage`, `done`); agent dùng tool `sf` của Gateway (ví dụ `artifact_read`) theo ngữ cảnh phiên; tin nhắn sau tiếp tục cùng phiên.

**Acceptance Scenarios**:
1. **Given** phiên `main` của video mẫu, **When** gửi "SCRIPT.md có bao nhiêu line?", **Then** luồng sự kiện có `tool_call` tới `mcp__sf__artifact_read`, `tool_result` ok, `text_delta`, `usage`, `done`.
2. **Given** tin nhắn thứ hai cùng phiên, **Then** runtime tiếp tục phiên trước (resume), không mất ngữ cảnh.
3. **When** `interrupt()`, **Then** luồng kết thúc với `done` (`stop_reason: interrupted`) hoặc `error`, không treo.

### User Story 2 - Phiên chỉ có công cụ được phép (Priority: P1)

**Acceptance Scenarios**:
1. **Given** mỗi loại phiên, **Then** `allowedTools` = built-in theo D5 mục 4 (`Read/Glob/Grep/Skill/TodoWrite` theo cột) + `mcp__sf__<tool>` mà Gateway cho phép loại đó; `disallowedTools` gồm `Write, Edit, MultiEdit, NotebookEdit, Bash, BashOutput, KillShell, WebFetch, WebSearch, Task`.
2. **Given** `canUseTool` nhận tool ngoài danh sách, **Then** từ chối kèm lý do (`E_TOOL_DENIED`).
3. **Given** `Read/Glob/Grep` với đường dẫn ngoài `channel_dir` và thư mục plugin, **Then** từ chối (`E_PATH_OUTSIDE`).
4. **Given** phiên `critic`, **Then** không nạp plugin, chỉ `mcp__sf__artifact_read`.
5. **Given** tùy chọn SDK, **Then** `settingSources: []`, chỉ một MCP server `sf`, `cwd` = thư mục video (hoặc kênh), `maxTurns` theo loại (main 60, frame 30, producer/critic 10), env không mang biến của phiên Claude Code bao ngoài.

### User Story 3 - Xác thực (Priority: P1)

**Acceptance Scenarios**:
1. **Given** đăng nhập gói Claude, **When** `authStatus()`, **Then** `{ok: true, method: 'claude-plan'}` mà không gửi prompt.
2. **Given** không đăng nhập nhưng có khóa API do `main` cung cấp (kho bí mật), **Then** dùng khóa qua env của tiến trình SDK (`method: 'api-key'`), không ghi khóa ra file/log.
3. **Given** không có gì, **Then** `{ok: false, method: 'none'}`; gửi tin nhắn → `error` `E_AUTH_REQUIRED`.

### User Story 4 - Ghi/phát lại cho kiểm thử (Priority: P1)

**Acceptance Scenarios**:
1. **Given** `SF_LLM=replay` và có bản ghi, **Then** runtime phát lại đúng chuỗi `AgentEvent` đã ghi, không gọi mạng.
2. **Given** `SF_LLM=replay` thiếu bản ghi, **Then** lỗi `E_LLM_FIXTURE_MISSING`.
3. **Given** `SF_LLM=record`, **Then** gọi runtime thật và ghi bản ghi; khóa không phụ thuộc đường dẫn tạm.

### User Story 5 - Plugin và chỉ dẫn hệ thống (Priority: P2)

**Acceptance Scenarios**:
1. Plugin `studioflow-core` (thư mục app) + `<channel>/profile` được truyền dưới dạng plugin local; gói workflow thêm ở 007.
2. `systemAppend` = văn bản FN-005 + phần theo loại phiên (frame có `output_path`).
3. CLI `sf agent auth` và `sf agent ask --channel <dir> [--video <vd>] [--kind main] <tin nhắn>` (in mảng sự kiện).

### Edge Cases
- Lỗi giới hạn tốc độ/hạn mức từ runtime → `error` `E_RUNTIME_RATE_LIMIT` (retryable).
- Đính kèm file → đường dẫn tương đối được nêu trong tin nhắn; `context_refs` gửi kèm dạng JSON.
- Agent gọi tool `sf` bị Gateway từ chối → `tool_result ok: false`, phiên tiếp tục.

## Requirements *(mandatory)*

- **FR-001**: Port `AgentRuntime`/`SessionOptions`/`AgentSession`/`AgentEvent` dùng nguyên văn từ D5 mục 1 (`docs/contracts/agent/d5.ts`).
- **FR-002**: Adapter `ClaudeAgentRuntime` ánh xạ tùy chọn theo tech-defaults mục 2 và đáp ứng 8 yêu cầu D5 mục 3.
- **FR-003**: `toolPolicy(kind, gateway)` dựng `ToolPolicy` từ bảng D5 mục 4 + danh sách tool Gateway theo loại.
- **FR-004**: `canUseTool` (lớp đầu D5 mục 5) từ chối tool ngoài policy và đường dẫn đọc ngoài `readRoots`.
- **FR-005**: Gateway gắn vào SDK dưới dạng MCP server trong tiến trình `{type:'sdk', name:'sf', instance}` của 003.
- **FR-006**: Ánh xạ thông điệp SDK → `AgentEvent` (text_delta, tool_call, tool_result, usage, done, error) với mã lỗi `E_AUTH_REQUIRED`, `E_RUNTIME_RATE_LIMIT`.
- **FR-007**: `authStatus()` không gửi prompt; khóa API dự phòng nhận qua hàm cung cấp bí mật, chỉ đặt vào env tiến trình SDK.
- **FR-008**: Runtime ghi/phát lại theo `SF_LLM` (D12 mục 2), khóa = (kind, model, systemAppend, tên plugin, tool cho phép, lịch sử tin nhắn của phiên).
- **FR-009**: Plugin `extensions/studioflow-core` (skill quy tắc domain) và chỉ dẫn hệ thống FN-005.
- **FR-010**: CLI `sf agent auth`, `sf agent ask`.

## Success Criteria *(mandatory)*
- **SC-001**: 100% ô bảng D5 mục 4 (tool built-in + Gateway) kiểm tự động trong `allowedTools`/`canUseTool`.
- **SC-002**: Bộ test chạy ở `SF_LLM=replay` không cần mạng; bản ghi được tạo bằng `record` trên máy tham chiếu.
- **SC-003**: Phiên `main` thật (record) đọc được artifact qua Gateway và không tạo được file ngoài Gateway khi được yêu cầu dùng Bash/Write.

## Phạm vi
**Trong**: port, adapter Claude, policy + canUseTool, ghi/phát lại, plugin `studioflow-core`, CLI.
**Ngoài**: UI chat (008), lưu lịch sử chat (008, FR-CH-07), nạp gói workflow (007), phiên `frame`/`producer`/`critic` trong luồng thật (009/011), instrumentation trace (015).

## Assumptions
- Model mặc định theo SDK (`claude-sonnet-5-5` ở thời điểm xác minh); `SessionOptions.model` ghi đè.
- Khóa bí mật dự phòng chỉ có khi `main` (008) cung cấp; ở 005 nhận qua tùy chọn `getApiKey()`.
