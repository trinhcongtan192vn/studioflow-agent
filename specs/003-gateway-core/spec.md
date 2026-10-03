# Feature Specification: Gateway Core (MCP server `sf`, artifact.*, config.*, script.run, chính sách)

**Feature Branch**: `003-gateway-core`

**Created**: 2026-10-03

**Status**: Draft

**Input**: Backlog `docs/README.md` mục 4, dòng 003: "gateway-core: MCP server, `artifact.*`, `script.run`, chính sách ghi/lệnh/mạng".

**Phủ yêu cầu**: FR-CH-06, NFR-01, một phần FR-CH-05 (cơ chế hỏi người dùng qua bus + các trường hợp ghi đè đã duyệt/frame ghim), một phần NFR-07/FR-OP-07 (che khóa bí mật trong log).

**Dựa trên `docs/`**: D4 mục 2 (Gateway: giao tiếp, `SessionContext`, `ToolResult`, hỏi người dùng giữa tool, danh mục tool), D4 mục 12 (cột agent của CLI) · D5 mục 4 (chính sách tool theo loại phiên), mục 5 (`canUseTool` + Gateway, 5.1 hỏi người dùng, 5.2 `script.run`, 5.3 mạng, 5.4 khóa bí mật), mục 7 (mã lỗi) · D3 mục 8 (module ghi), D9 mục 2 (`owner`, file cảnh) · D12 mục 5 (test an toàn file) · tech-defaults mục 1 (Gateway in-process/HTTP), mục 3 (`script.run` 10 phút, 1 MB; chờ xác nhận 10 phút).

## Bối cảnh & mục tiêu

Agent chỉ được ghi file và chạy lệnh qua Gateway (FR-CH-06). Tính năng này dựng Gateway — MCP server tên `sf` — với nhóm tool nền (`artifact.read/write/validate/list`, `config.resolve/set`, `script.run`), lớp chính sách bắt buộc ở Gateway (theo loại phiên, phạm vi đường dẫn, owner, `base_hash`, schema), cơ chế hỏi người dùng giữa tool, và registry tool để các tính năng sau (004+ `graph.*`, `job.*`, 007 `workflow.*`, capability…) đăng ký thêm tool mà không sửa lõi Gateway.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Agent đọc/ghi artifact qua Gateway (Priority: P1)

Một phiên agent (gắn `SessionContext`) gọi `artifact.read`, `artifact.list`, `artifact.validate`, `artifact.write` cho kênh/video hiện tại. Ghi hợp lệ trả `{hash, assigned_ids?}`; `SCRIPT.md`/`STORYBOARD.md` có line/beat/scene/frame/layer mới được gán ID.

**Why this priority**: Đường duy nhất để agent tạo nội dung (FR-CH-06, NFR-01).

**Independent Test**: Gọi tool trực tiếp qua registry và qua MCP client thật; kiểm kết quả `ToolResult`.

**Acceptance Scenarios**:

1. **Given** phiên `main` của video, **When** `artifact.read {path: "SCRIPT.md"}`, **Then** `{ok: true, data: {content, hash, schema_version: 1}}`; đường dẫn tương đối thư mục video.
2. **Given** phiên `main`, **When** `artifact.write` `SCRIPT.md` có line chưa có ID, **Then** file được ghi với ID mới, trả `{hash, assigned_ids}`.
3. **Given** nội dung sai schema, **When** `artifact.write`, **Then** `{ok: false, error: {code: 'E_SCHEMA_INVALID', retryable: false, details}}`, file không đổi.
4. **Given** `base_hash` khác hash hiện tại, **When** `artifact.write`, **Then** `E_BASE_HASH_MISMATCH`.
5. **Given** `artifact.list {glob: "**/*.md"}`, **Then** trả danh sách đường dẫn trong video, không có `.sf/`.
6. **Given** phiên có `read_only_videos: [vd_x]`, **When** `artifact.read {path: "video:vd_x/SCRIPT.md"}`, **Then** đọc được; `artifact.write` tới `video:vd_x/…` → `E_SCOPE_DENIED`.

---

### User Story 2 - Chính sách theo loại phiên và phạm vi (Priority: P1)

Gateway kiểm lại mọi lần gọi: tool không có trong cột loại phiên (D5 mục 4) → `E_TOOL_DENIED`; phiên `frame`/`producer` ghi ngoài `allowed_paths` → `E_SCOPE_DENIED`; đường dẫn ra ngoài kênh/video → `E_PATH_OUTSIDE`; ghi file cảnh khi `owner = studio` → `E_OWNER_CONFLICT`.

**Why this priority**: Lớp bắt buộc của D5 mục 5; không tin đầu vào agent.

**Independent Test**: Ma trận (kind × tool) theo D5 mục 4; bộ 20 lời gọi đối nghịch (D12 mục 5) → 0 lần lọt.

**Acceptance Scenarios**:

1. **Given** phiên `critic`, **When** gọi bất kỳ tool nào trừ `artifact.read`, **Then** `E_TOOL_DENIED`.
2. **Given** phiên `frame` với `allowed_paths: ["compositions/frames/fr_x.html"]`, **When** ghi `SCRIPT.md`, **Then** `E_SCOPE_DENIED`; ghi đúng file được phép thì thành công.
3. **Given** bất kỳ phiên, **When** đường dẫn tuyệt đối, chứa `..`, hoặc qua junction ra ngoài, **Then** `E_PATH_OUTSIDE`, không file nào bị tạo.
4. **Given** `state.json.owner = 'studio'`, **When** agent ghi `compositions/**`, `index.html`, `hyperframes.json`, `caption-overrides.json`, **Then** `E_OWNER_CONFLICT`; file không phải file cảnh vẫn ghi được.
5. **Given** bộ 20 lời gọi đối nghịch ghi sẵn, **When** chạy, **Then** không lời gọi nào ghi được file ngoài phạm vi hay chạy được lệnh ngoài danh sách.

---

### User Story 3 - Hỏi người dùng giữa tool (Priority: P1)

Khi ghi đè artifact đã duyệt hoặc file frame đã ghim, handler tool phát `permission.requested {request_id, session_id, tool, summary, estimate}` lên bus của `core` và **chờ** `permission.decide`. Đồng ý → ghi (kèm sao lưu) và trả kết quả bình thường; từ chối hoặc hết thời gian (10 phút) → `E_PERMISSION_DECLINED`.

**Why this priority**: FR-CH-05 phần ghi đè; cơ chế dùng lại cho batch/render/API có phí ở các tính năng sau.

**Independent Test**: Ghi đè `SCRIPT.md` đã duyệt; nghe bus, trả lời đồng ý/từ chối; thời gian chờ rút ngắn trong test.

**Acceptance Scenarios**:

1. **Given** `SCRIPT.md` thuộc approval `approved`, **When** `artifact.write`, **Then** bus nhận `permission.requested` một lần và tool chưa trả kết quả.
2. **When** `permission.decide {allow: true}`, **Then** ghi thành công, có bản sao lưu.
3. **When** `permission.decide {allow: false}` hoặc hết thời gian chờ, **Then** `E_PERMISSION_DECLINED`, file không đổi.
4. **Given** quyết định "luôn cho phép trong video này" cho loại `batch_gen`/`paid_api`, **Then** lưu vào `state.json.config_overrides` khóa `policy.auto_approve.*`; ghi đè đã duyệt **không** có lựa chọn "luôn".

---

### User Story 4 - `script.run` theo danh sách cho phép (Priority: P1)

Agent chạy lệnh qua `script.run {command, args[]}`: chỉ lệnh trong danh sách D5 mục 5.2, không qua shell, `cwd` = thư mục video, biến môi trường tối thiểu, không mạng (proxy chặn), giới hạn 10 phút và 1 MB đầu ra. Đối số có `..`, đường dẫn tuyệt đối ngoài project, ký tự shell → `E_SCRIPT_DENIED`.

**Why this priority**: Đường duy nhất để agent chạy lệnh (FR-CH-06).

**Independent Test**: `script.run sf artifact validate SCRIPT.md` thành công; các biến thể bị chặn; lệnh treo bị cắt theo thời gian; đầu ra lớn bị cắt.

**Acceptance Scenarios**:

1. **Given** `command: "sf", args: ["artifact","validate","SCRIPT.md"]`, **Then** chạy `sf` của app với `cwd` video, trả `{exit_code, stdout, stderr, truncated}`.
2. **Given** `sf` lệnh không có dấu ✓ agent (ví dụ `sf artifact migrate`), **Then** `E_SCRIPT_DENIED`.
3. **Given** lệnh ngoài danh sách (`powershell`, `cmd`, `node`, `git`), **Then** `E_SCRIPT_DENIED`.
4. **Given** đối số `..\x`, `C:\Windows`, `a|b`, `$(x)`, `;rm`, **Then** `E_SCRIPT_DENIED`.
5. **Given** lệnh chạy quá giới hạn thời gian (giá trị nhỏ trong test), **Then** bị dừng, trả lỗi có `timed_out: true`.
6. **Given** tiến trình con, **Then** biến môi trường chỉ gồm danh sách tối thiểu (không có khóa API/`ANTHROPIC_API_KEY`), `HTTP_PROXY`/`HTTPS_PROXY` trỏ proxy chặn.

---

### User Story 5 - MCP server dùng được bởi runtime (Priority: P2)

Gateway mở được dưới dạng MCP server tên `sf`: (a) đối tượng server trong tiến trình cho runtime chạy cùng `core` (005 gắn vào Claude Agent SDK), (b) Streamable HTTP chỉ trên `127.0.0.1` với `Authorization: Bearer <token>` sinh mỗi lần khởi động. Tên tool MCP thay `.` bằng `_`.

**Why this priority**: Runtime khác (và test tích hợp) cần giao tiếp chuẩn MCP; 005 dùng bản trong tiến trình.

**Independent Test**: MCP client thật kết nối HTTP, `tools/list` theo loại phiên, gọi `artifact_read`; không token / sai token → 401; bind chỉ 127.0.0.1.

**Acceptance Scenarios**:

1. **Given** server HTTP đang chạy cho một phiên, **When** client có token gọi `tools/list`, **Then** chỉ thấy tool được phép cho loại phiên, tên dạng `artifact_read`.
2. **When** gọi không token hoặc sai token, **Then** HTTP 401, không thực thi tool.
3. **When** tool lỗi, **Then** kết quả MCP mang `ToolResult` `{ok: false, error}` (không ném lỗi giao thức).
4. **Given** CLI `sf gateway serve --channel <dir> [--video <vd>] [--kind main]`, **Then** in `{url, token}` JSON và phục vụ tới khi bị dừng.

---

### User Story 6 - Đăng ký tool của tính năng sau (Priority: P2)

Tính năng sau đăng ký tool (`name`, schema đầu vào, các loại phiên được phép, handler) vào registry; Gateway tự áp chính sách chung (loại phiên, `ToolResult`, ánh xạ lỗi `SfError` → `retryable` từ `errors.json`).

**Acceptance Scenarios**:

1. **Given** một tool giả đăng ký cho `main`, **Then** xuất hiện trong `tools/list` của `main`, không của `frame`.
2. **Given** handler ném `SfError('E_PROVIDER_FAILED')`, **Then** `ToolResult.error.retryable = true` (theo `errors.json`).
3. **Given** handler ném lỗi không phải `SfError`, **Then** `E_INTERNAL`, không lộ stack.

### Edge Cases

- `artifact.read` file nhị phân → trả `{encoding: 'base64'}`; file > 1 MB → lỗi rõ ràng thay vì làm tràn ngữ cảnh agent.
- `artifact.write` khi đích là thư mục → lỗi `E_SCHEMA_INVALID`/`E_PATH_OUTSIDE` thích hợp, không ghi.
- `artifact.list` glob có `..` → `E_PATH_OUTSIDE`.
- Phiên kênh (chưa có video): đường dẫn tương đối thư mục kênh; ghi `channel.json` kiểm tầng cấu hình.
- Hai yêu cầu xác nhận đồng thời: mỗi yêu cầu có `request_id` riêng, quyết định không lẫn.
- `script.run` lệnh không tồn tại trên máy (ví dụ HyperFrames chưa cài) → lỗi rõ, không treo.
- Log chứa chuỗi giống khóa API (`sk-…`, `sk-ant-…`) → bị che.

## Requirements *(mandatory)*

### Functional Requirements

**Registry & kết quả**

- **FR-001**: PHẢI có registry tool: mỗi tool khai báo tên logic `nhóm.tên`, schema đầu vào (JSON Schema), tập loại phiên được phép (D5 mục 4) và handler nhận `SessionContext`.
- **FR-002**: Mọi tool PHẢI trả `ToolResult` (D4 mục 2.3); `retryable` lấy từ `docs/contracts/errors.json`; lỗi không phải `SfError` → `E_INTERNAL` với thông báo ngắn.
- **FR-003**: Đầu vào tool PHẢI được kiểm theo schema trước khi gọi handler; sai → `E_SCHEMA_INVALID` (lỗi tham số).

**Chính sách**

- **FR-004**: Gateway PHẢI từ chối tool ngoài cột loại phiên (D5 mục 4) với `E_TOOL_DENIED`, kể cả khi được gọi trực tiếp.
- **FR-005**: Đường dẫn PHẢI tương đối thư mục video (hoặc kênh khi phiên chưa có video); tiền tố `video:<vd>/` chỉ cho `artifact.read/list` với video trong `read_only_videos`; ngoài phạm vi → `E_PATH_OUTSIDE` / `E_SCOPE_DENIED`.
- **FR-006**: Phiên `frame` chỉ ghi các file trong `allowed_paths`; phiên `producer` chỉ ghi `allowed_paths` (artifact của bước) → ngoài → `E_SCOPE_DENIED`.
- **FR-007**: Ghi file cảnh (`compositions/**`, `index.html`, `hyperframes.json`, `caption-overrides.json`) khi `state.json.owner = 'studio'` → `E_OWNER_CONFLICT`.
- **FR-008**: `artifact.write` có `base_hash` khác hash hiện tại → `E_BASE_HASH_MISMATCH`.

**Hỏi người dùng**

- **FR-009**: PHẢI có bus sự kiện trong `core` với `permission.requested {request_id, session_id, tool, summary, estimate?}` và `permission.decide {request_id, allow, always?}`; handler chờ; từ chối/hết thời gian (mặc định 10 phút) → `E_PERMISSION_DECLINED`.
- **FR-010**: Ghi đè artifact thuộc approval `approved` và ghi file frame đã ghim PHẢI hỏi người dùng mỗi lần (không có "luôn cho phép").
- **FR-011**: Bus PHẢI hỗ trợ "luôn cho phép trong video này" cho loại `batch_gen` và `paid_api`, lưu `policy.auto_approve.*` vào `state.json.config_overrides` qua module ghi; lần sau cùng loại không hỏi.

**Tool nền**

- **FR-012**: `artifact.read {path}` → `{content, hash, schema_version?}` (văn bản) hoặc base64 với nhị phân; giới hạn 1 MB.
- **FR-013**: `artifact.write {path, content, base_hash?}` → `{hash, assigned_ids?}`: gán ID (`SCRIPT.md`, `STORYBOARD.md`), kiểm schema, kiểm cấu hình tầng khi ghi `channel.json`/`state.json`, sao lưu qua module ghi (002).
- **FR-014**: `artifact.validate {path} | {path, content}` → `{valid, errors[]}`, gồm kiểm chéo video khi là `SCRIPT.md`/`STORYBOARD.md`.
- **FR-015**: `artifact.list {glob}` → `{paths[]}` trong phạm vi, bỏ `.sf/`.
- **FR-016**: `config.resolve {key, scene_id?, frame_id?}` và `config.set {key, value, tier}` dùng API của 002.
- **FR-017**: `script.run {command, args[]}` theo D5 mục 5.2: danh sách cho phép (HyperFrames theo đối số, `sf` chỉ lệnh có ✓ agent ở D4 mục 12, script gói workflow khi 007 cung cấp), không shell, `cwd` video, env tối thiểu, proxy chặn mạng, 10 phút, 1 MB; vi phạm → `E_SCRIPT_DENIED`.

**Giao tiếp**

- **FR-018**: Gateway PHẢI tạo được MCP server tên `sf` trong tiến trình cho một `SessionContext` (cho 005), tên tool MCP thay `.` bằng `_`.
- **FR-019**: Gateway PHẢI phục vụ được MCP Streamable HTTP chỉ trên `127.0.0.1`, cổng ngẫu nhiên, token Bearer sinh mỗi lần; sai/thiếu token → 401.
- **FR-020**: PHẢI có CLI `sf gateway serve --channel <dir> [--video <vd>] [--kind <kind>]` và `sf gateway tools [--kind <kind>]`.

**Log**

- **FR-021**: PHẢI có logger JSON có cấu trúc (Điều VII) dùng trong Gateway, che chuỗi khớp mẫu khóa bí mật (D5 mục 5.4) và ghi mỗi lần gọi tool `{tool, session_id, kind, ok, code?, ms}`.

### Key Entities

`SessionContext` (D4 mục 2.2), `ToolResult` (D4 mục 2.3) — dùng nguyên văn từ `docs/contracts` (thêm vào hợp đồng ở tính năng này). Riêng: **ToolDefinition** (name, input schema, kinds, handler), **PermissionRequest** (request_id, session_id, tool, summary, estimate, kind: `overwrite_approved | pinned_frame | batch_gen | paid_api | render`).

## Success Criteria *(mandatory)*

- **SC-001**: 20 lời gọi đối nghịch (D12 mục 5) → 0 lần ghi ngoài phạm vi / chạy lệnh ngoài danh sách.
- **SC-002**: 100% ô của bảng D5 mục 4 (với tool đã có ở 003) được kiểm tự động.
- **SC-003**: MCP client thật gọi được mọi tool nền qua HTTP với token; không token → 401.
- **SC-004**: Độ phủ dòng `packages/core` ≥ 80%.

## Phạm vi

**Trong phạm vi**: registry, chính sách, bus xác nhận, tool `artifact.*`, `config.*`, `script.run`, MCP trong tiến trình + HTTP, logger có che khóa, CLI `sf gateway`.

**Ngoài phạm vi**: `job.*`/job queue (004 — `script.run` ở 003 chạy đồng bộ và trả kết quả trực tiếp), `graph.*` (004), `workflow.*`/`approval.annotate` (007), capability tool (006+), `studio.*` (017/025), `canUseTool` của runtime (005), IPC tới UI (008; 003 chỉ cung cấp bus trong `core`), `upload.ingest` (008).

## Assumptions

- `ToolPolicy` của D5 mục 4 cho `Read/Glob/Grep/Skill/TodoWrite` là tool built-in của runtime, không thuộc Gateway (005 xử lý ở `canUseTool`).
- `script.run` trả kết quả đồng bộ ở 003; khi 004 có job queue sẽ chuyển thành job (`job_id`) theo D4 mục 2.3 — giữ nguyên hình dạng `data`.
- Cơ chế chặn mạng chi tiết `[chờ S8]`: 003 đặt `HTTP_PROXY`/`HTTPS_PROXY` tới một cổng từ chối trên `127.0.0.1` và xóa biến khóa khỏi env.
- `hyperframes` chưa cài ở 003 (thuộc 011): quy tắc đối số được cài đặt và test bằng cấu hình; lệnh thiếu trên máy → lỗi rõ.
