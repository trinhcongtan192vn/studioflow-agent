# D5 — Spec Agent Runtime, tool và chính sách

**Phiên bản:** 1.3 · **Ngày:** 03/10/2026
**Dựa trên:** `00-architecture.md` mục 11 · `04-spec-capability-gateway.md` mục 2
**Phủ:** FR-CH-01/05/06, FR-ST-06, FR-OP-07, NFR-01/07/08
**Tính năng triển khai:** 003 (chính sách), 005 `agent-runtime-claude`

---

## 1. Agent Runtime Port

```ts
interface AgentRuntime {
  id: string;                                   // 'claude-agent-sdk'
  authStatus(): Promise<{ ok: boolean; method: 'claude-plan' | 'api-key' | 'none'; detail?: string }>;
  openSession(opts: SessionOptions): Promise<AgentSession>;
}

interface SessionOptions {
  kind: 'main' | 'frame' | 'producer' | 'critic';
  context: SessionContext;                      // D4 mục 2.2
  model: string;                                // theo bảng mục 2
  systemAppend: string;                         // quy tắc app (mục 6) + chỉ dẫn theo kind
  plugins: string[];                            // đường dẫn tuyệt đối thư mục plugin (mục 3)
  tools: ToolPolicy;                            // mục 4
  resume?: string;                              // id phiên để tiếp tục (chỉ 'main')
  maxTurns?: number; budgetTokens?: number;
  telemetry: { traceparent: string };           // D11
}

interface AgentSession {
  id: string;
  send(message: UserMessage): AsyncIterable<AgentEvent>;
  interrupt(): Promise<void>;
  close(): Promise<void>;
}

type UserMessage = { text: string; attachments?: { path: string; mime: string }[]; context_refs?: ContextRef[] };
type ContextRef = { kind: 'frame' | 'time' | 'element' | 'caption_group'; id?: string; time_ms?: Ms };

type AgentEvent =
  | { type: 'text_delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; id: string; ok: boolean; summary: string }
  | { type: 'usage'; input_tokens: number; output_tokens: number; cost_usd?: number }
  | { type: 'done'; stop_reason: string }
  | { type: 'error'; code: string; message: string };

type ToolPolicy = { allowed: string[]; readRoots: string[] };   // allowed: tên tool MCP + built-in theo mục 4; readRoots: thư mục cho Read/Glob/Grep
```

Quyết định xác nhận của người dùng không đi qua `AgentEvent`; xem mục 5.1.

Mọi phần khác của app chỉ dùng giao diện này. Thêm runtime mới = viết lớp cài đặt `AgentRuntime` + chạy hồi quy (D12).

## 2. Loại phiên

| Kind | Mở khi | Ngữ cảnh | Model mặc định | Sống |
|---|---|---|---|---|
| `main` | Người dùng mở chat của kênh/video | Hồ sơ kênh + trạng thái video + lịch sử chat | Claude Sonnet mới nhất `[chờ S8]` | Theo video (hoặc theo kênh khi chưa chọn video, chat lưu `<channel>/chat/`); tiếp tục bằng `resume` |
| `frame` | Bước `frame-build` | Frame packet (D6) | như `main` | Một frame; đóng sau `workflow.step_complete` |
| `producer` | `refine-loop` của storyboard | Brief, script, hồ sơ kênh, nhận xét vòng trước | như `main` | Một vòng |
| `critic` | `text.review` với provider `text.claude` | Chỉ bản nháp + rubric + brief | Claude khác tầng với producer khi producer cũng là Claude | Một lần chấm |

Song song: tối đa `frame_build.parallel` phiên `frame` (D3 mục 7.2). Phiên `critic`/`producer` không có lịch sử chat.

## 3. Yêu cầu với mọi adapter runtime

Mọi cài đặt `AgentRuntime` (bản đầu: Claude Agent SDK) PHẢI bảo đảm:
1. **Không nạp cấu hình ngoài app:** không đọc cài đặt, hook, skill, MCP server của người dùng hay của thư mục làm việc ngoài những gì app truyền vào.
2. **Chỉ nạp skill từ thư mục app chỉ định:** `studioflow-core`, gói workflow đang dùng (ưu tiên `<app-data>/extensions/`, sau đó `<install>/resources/extensions/`), `<channel>/profile` — theo bố cục plugin (D6).
3. **Chỉ một MCP server:** `sf` (Gateway) gắn với `SessionContext` của phiên.
4. **Tắt công cụ có sẵn ghi file, chạy lệnh, mạng, sub-agent riêng của runtime** (với Claude Agent SDK: `Write, Edit, MultiEdit, NotebookEdit, Bash, BashOutput, KillShell, WebFetch, WebSearch, Task`); chỉ cho tool theo bảng mục 4.
5. **Có móc quyết định quyền** cho mỗi lần gọi tool (lớp đầu, mục 5).
6. **Giới hạn số lượt** mỗi lần gửi theo loại phiên (giá trị: tech-defaults).
7. **Xác thực:** mặc định gói Claude của người dùng `[chờ S8]`; dự phòng khóa API Anthropic từ kho bí mật. Không ghi thông tin xác thực ra file.
8. Phiên `critic`: không nạp plugin, chỉ `artifact.read`.

Ánh xạ cụ thể sang tùy chọn của Claude Agent SDK: tech-defaults.

## 4. Chính sách tool theo loại phiên

| Tool | main | frame | producer | critic |
|---|---|---|---|---|
| `Read`, `Glob`, `Grep` (chỉ project + thư mục plugin) | ✓ | ✓ | ✓ | — |
| `Skill` | ✓ | ✓ | ✓ | — |
| `TodoWrite` | ✓ | ✓ | — | — |
| `artifact.read/list/validate`, `config.resolve` | ✓ | ✓ | ✓ | ✓ (`read`) |
| `config.set` | ✓ | — | — | — |
| `artifact.write` | ✓ | chỉ `allowed_paths` | chỉ artifact của bước | — |
| `script.run` | ✓ | lint/check/snapshot của frame mình | — | — |
| `graph.*`, `workflow.*` (gồm `list`, `select`, `run_to`, `pause`, `rewind`), `approval.annotate` | ✓ | `workflow.step_complete` | `workflow.step_complete` | — |
| `asset.import`, `asset.search` | ✓ | `asset.search` | — | — |
| capability (`tts.*`, `asr.*`, `voice.*`, `image.*`, `music.*`, `sfx.*`, `lipsync.*`, `grade.*`, `media.*`) | ✓ | `image.*` | — | — |
| `render.video`, `studio.*` | ✓ | — | — | — |
| `youtube.*` (044) | ✓ | — | — | — |
| `research.scan`, `research.get` (049) | ✓ | — | — | — |
| `autopilot.plan_get`, `autopilot.plan_run`, `autopilot.plan_update` (051) | ✓ | — | — | — |
| `autopilot.status` (052) | ✓ | — | — | — |
| `job.*` | ✓ | ✓ | — | — |

Tool không có trong cột → không được liệt kê cho phiên đó (`allowedTools`) và bị `canUseTool` từ chối nếu vẫn gọi.

## 5. `canUseTool` và chính sách ở Gateway

Hai lớp, lớp sau là bắt buộc:

1. **`canUseTool` (lớp đầu):** từ chối tool ngoài bảng mục 4; với `Read/Glob/Grep` từ chối đường dẫn ngoài `channel_dir` và thư mục plugin; trả lý do cho agent.
2. **Gateway (bắt buộc):** mọi tool `sf` kiểm lại `SessionContext`, phạm vi đường dẫn (`E_PATH_OUTSIDE`, `E_SCOPE_DENIED`), owner (`E_OWNER_CONFLICT`), `base_hash`, schema. Gateway không tin đầu vào từ agent.

### 5.1 Hỏi người dùng (FR-CH-05)
Cơ chế: handler tool **chờ** quyết định qua bus sự kiện của `core` (D4 mục 2.3); UI hiện thẻ xác nhận từ sự kiện `permission.requested`; từ chối hoặc hết thời gian chờ → `E_PERMISSION_DECLINED`. Áp dụng khi:

| Hành động | Ngưỡng (khóa cấu hình, D3 mục 7.2) |
|---|---|
| Sinh hàng loạt (`graph.build`, `tts.synthesize "all"`, `image.*` nhiều ảnh) | vượt `policy.batch.tts_lines` hoặc `policy.batch.images` trong một lệnh |
| Render | mọi lần (`render.video`) |
| API có phí | ước tính vượt `policy.paid_api.per_call_usd` một lệnh, hoặc vượt `policy.budget_warn_ratio` ngân sách video |
| Ghi đè artifact đã duyệt | luôn |
| Ghi đè/sinh lại frame đã ghim | luôn (D9 mục 5) |
| Xóa | không có tool xóa; dọn dẹp chỉ qua màn dung lượng (người dùng tự bấm) |

Chế độ tự động (`workflow.autopilot`, 034): sinh hàng loạt miễn phí được đồng ý tự động; ghi đè artifact của approval **tự duyệt** không hỏi; API có phí và render vẫn hỏi.

**Video do Autopilot tạo (052, `state.autopilot`)** chạy không có người: yêu cầu `paid_api` **không chờ** — app vẫn phát `permission.requested` (người dùng thấy), tool trả `E_PERMISSION_DECLINED` ngay, và mục kế hoạch được đỗ `needs_review` với lý do "cần xác nhận chi phí: <tóm tắt>" (an toàn mặc định; người dùng cho phép rồi làm tiếp video bằng tay). `batch_gen` vẫn tự đồng ý như chế độ tự động.

Người dùng có thể chọn "luôn cho phép trong video này" cho hàng 1 và 3; lưu ở `state.json.config_overrides` khóa `policy.auto_approve.batch_gen` / `policy.auto_approve.paid_api` (D3 mục 7.2). Render luôn hỏi.

### 5.2 `script.run` — danh sách cho phép

| Lệnh | Đối số cho phép | Ghi file? |
|---|---|---|
| `hyperframes lint` / `check` | đường dẫn trong video | không |
| `hyperframes snapshot` | đường dẫn trong video, `--out .sf/snapshots/…` | `.sf/` |
| `hyperframes catalog` | `list`, `show <id>` | không |
| `hyperframes add` | id khối catalog | `compositions/` (kiểm owner) |
| `hyperframes media-treatment` | `--dry-run` hoặc `--apply` trên asset của video | `public/` |
| `hyperframes grade-compare` | asset của video | `.sf/` |
| `sf <module> <lệnh>` | lệnh có dấu ✓ ở cột agent của D4 mục 12 | theo lệnh |
| script trong gói workflow | khai báo trong `workflow.yaml` `scripts:` | theo khai báo |

- Chạy qua wrapper: `cwd` = thư mục video, biến môi trường tối thiểu, **không qua shell** (mảng đối số), có giới hạn thời gian và dung lượng đầu ra (giá trị: tech-defaults).
- Đối số chứa `..`, đường dẫn tuyệt đối ngoài project, ký tự shell (`|&;><$\``) → `E_SCRIPT_DENIED`.

### 5.3 Mạng
- Agent không có tool mạng.
- `core` chỉ gọi ra ngoài tới: Anthropic (qua SDK), OpenAI, DeepSeek, nhà cung cấp ảnh đã cấu hình, máy chủ model trong `models.yaml`, YouTube Data API (`www.googleapis.com`, 044/049), Google Trends / Google News RSS (`trends.google.com`, `news.google.com`, quét nghiên cứu 049), và `127.0.0.1` (ComfyUI, worker, Studio, Phoenix). Danh sách nằm trong `settings.json.network.allow`.
- Lệnh `script.run` không có mạng trừ khi được đánh dấu cần mạng trong danh sách cho phép (cơ chế chặn: tech-defaults `[chờ S8]`).

### 5.4 Khóa bí mật (FR-OP-07)
- Lưu trong kho bí mật của Windows (Credential Manager), tên `StudioFlow/<provider>`; chỉ `main` đọc/ghi, chuyển cho `core` qua IPC khi cần.
- Không ghi khóa vào file, log, trace, provenance; logger che chuỗi khớp mẫu khóa.

## 6. Chỉ dẫn hệ thống (`systemAppend`)

Mọi phiên nhận chỉ dẫn hệ thống nêu lại các quy tắc của tài liệu này mà agent cần biết để hợp tác: chỉ ghi/chạy lệnh qua Gateway, theo workflow hiện tại và báo xong bước, không tự duyệt, dùng capability theo tên, không sửa frame đã ghim khi chưa được phép, ngôn ngữ trả lời, hỏi khi thiếu thông tin. Văn bản cụ thể: FN-005. Chỉ dẫn này **không thay thế** chính sách ở Gateway.

## 7. Mã lỗi

| Mã | Khi |
|---|---|
| `E_TOOL_DENIED` | Tool không được phép cho phiên |
| `E_SCRIPT_DENIED` | Lệnh/đối số ngoài danh sách cho phép |
| `E_PATH_OUTSIDE` | Đường dẫn ra ngoài phạm vi (D3) |
| `E_AUTH_REQUIRED` | Chưa đăng nhập Claude/thiếu khóa |
| `E_RUNTIME_RATE_LIMIT` | Runtime báo giới hạn tốc độ/hạn mức (retryable) |
| `E_PERMISSION_DECLINED` | Người dùng từ chối ở hộp xác nhận |
