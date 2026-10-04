# Tech defaults — lựa chọn công nghệ mặc định

**Phiên bản:** 1.0 · **Ngày:** 03/10/2026

> **Không ràng buộc như spec hệ thống.** Đây là lựa chọn công nghệ và tham số kỹ thuật **mặc định gợi ý** cho bước `/plan` của từng tính năng. `plan.md` được chọn khác nếu ghi lý do (mục *Complexity Tracking* hoặc `research.md`) và vẫn thỏa constitution + hợp đồng trong D3–D13. Khi một lựa chọn đã được dùng trong code, đổi nó là một quyết định kỹ thuật, ghi lại trong `research.md` của tính năng gây ra thay đổi.

Đã chốt ở tầng sản phẩm (không thuộc file này): Windows 11 x64; Electron + React (TypeScript); lõi TypeScript/Node; worker Python; Claude Agent SDK là runtime đầu tiên; HyperFrames; ComfyUI; OmniVoice; Qwen-Image-2.1.

## 1. Tiến trình và giao tiếp

| Chủ đề | Mặc định |
|---|---|
| Tiến trình `core` | Electron `utilityProcess` (Node 22) |
| IPC renderer ↔ core | JSON-RPC 2.0 qua `MessagePort` do `main` cấp |
| Dừng tiến trình con khi `core` thoát | Windows Job Object (kill-on-close) |
| Gateway với Claude Agent SDK | `createSdkMcpServer` trong tiến trình `core`, tên server `sf` |
| Gateway cho runtime khác | MCP Streamable HTTP trên `127.0.0.1:<cổng ngẫu nhiên>`, header `Authorization: Bearer <token>` |
| Worker Python | JSON-RPC 2.0 qua stdio (một JSON mỗi dòng), log ra stderr |
| Môi trường Python | `uv`, venv riêng mỗi engine, `requirements.lock` |
| SQLite | `better-sqlite3` (đồng bộ, trong `core`) |
| Theo dõi file | `chokidar` |
| Kho bí mật | thư viện keyring native (ví dụ `@napi-rs/keyring`) trong `main` |
| Phân tích HTML | `parse5` / `linkedom` |
| Diff cây cú pháp JS (D9 mục 3.4 b) | `acorn` |
| Schema validation | Ajv (TS), `jsonschema` (Python); type sinh bằng `json-schema-to-typescript` hoặc ngược lại |

## 2. Ánh xạ Claude Agent SDK (D5 mục 3)

| Tùy chọn SDK | Giá trị |
|---|---|
| `cwd` | thư mục video (hoặc kênh nếu chưa có video) |
| `settingSources` | `[]` |
| `plugins` | `[{type:'local', path}]` cho `studioflow-core`, gói workflow, `<channel>/profile` |
| `mcpServers` | `{ sf: createSdkMcpServer(gatewayTools(context)) }` |
| `allowedTools` / `disallowedTools` | theo D5 mục 3–4 |
| `permissionMode` | `default`; quyết định ở `canUseTool` |
| `systemPrompt` | preset của SDK + `append: systemAppend` |
| `maxTurns` | main: 60 mỗi tin nhắn; frame: 30; producer/critic: 10 |
| Khóa API dự phòng | biến môi trường `ANTHROPIC_API_KEY` cho tiến trình SDK |

## 3. Tham số vận hành

| Tham số | Mặc định |
|---|---|
| Thử lại job | tối đa 3 lần chạy; chờ 2 s rồi 10 s |
| Adapter dừng sau khi hủy | ≤ 5 s |
| Cửa sổ gom thay đổi lẻ từ chat | 3 s |
| Chờ người dùng xác nhận | 10 phút → `E_PERMISSION_DECLINED` |
| `script.run` | giới hạn 10 phút; trả tối đa 1 MB stdout/stderr |
| Chặn mạng của `script.run` | biến `HTTP(S)_PROXY` trỏ tới proxy chặn trong `core` `[chờ S8]` |
| Tải model | HTTP `Range`, file `*.part`, kiểm sha256 rồi đổi tên |
| Log | giữ 14 ngày |

## 4. Âm thanh và hình

| Chủ đề | Mặc định |
|---|---|
| Phân tích nhạc | `librosa` (BPM, RMS, chroma), `pyloudnorm` (LUFS) `[chờ S11]` |
| Embedding nhạc | model họ CLAP chạy CPU `[chờ S11]` |
| Xếp hạng từ khóa | BM25 trên chuỗi gộp tags/title/description |
| Trộn/chuẩn hóa | FFmpeg `loudnorm` hai lượt; ducking dự phòng `sidechaincompress` |

## 5. Quan sát

| Chủ đề | Mặc định |
|---|---|
| Instrumentation agent | `@arizeai/openinference-instrumentation-claude-agent-sdk` `[chờ S13]` |
| Span tự tạo | `@opentelemetry/api` + exporter tự viết vào SQLite |
| Phoenix | `phoenix serve` cục bộ; OTLP HTTP `http://127.0.0.1:6006/v1/traces` |
| Metric token của Claude Code | `CLAUDE_CODE_ENABLE_TELEMETRY=1` (chỉ metric, không bật trace) |

## 6. Kiểm thử và CI

| Chủ đề | Mặc định |
|---|---|
| Test TS | Vitest |
| Test Python | pytest |
| Test UI | Playwright for Electron |
| CI | GitHub Actions `windows-latest`, Node 22, Python 3.11 (uv), FFmpeg |
| Độ phủ | dòng `packages/core` ≥ 80% |
| Dự án mẫu | 30–60 giây; dung sai thời lượng ±5%, loudness ±1 LU; contact sheet SSIM ≥ 0,90 |
| Test an toàn file | 20 prompt đối nghịch; 0 lần lọt |
| Test ghi nguyên tử | 1 000 lần giết `core` giữa lúc ghi |
| Đóng gói app | electron-builder (NSIS) |

## 7. Giá trị mặc định của khóa cấu hình (D3 mục 7.2)

| Khóa | Mặc định |
|---|---|
| `output.profile` | `yt-1080p30` |
| `workflow.default` | `narrated-explainer` |
| `voice.id` | — |
| `look.id` | `neutral` |
| `font.family` | `Be Vietnam Pro` |
| `caption.style` | `caption-highlight` |
| `caption.max_words` | 7 |
| `voice.pause_after_ms` | 0 (khoảng lặng sau line không khai báo `pause_after_ms`; essay 600) |
| `overlay.rules` | `[]` |
| `provider.<capability>` | theo D4 mục 4.3 |
| `text.producer` / `text.critic` / `text.aux` | theo D4 mục 4.3 |
| `refine.min_rounds` / `refine.max_rounds` / `refine.threshold` | 2 / 3 / 8.0 `[chờ S14]` |
| `frame.min_duration_ms` | 2000 |
| `frame_build.parallel` | 2 `[chờ S4]` |
| `budget.tokens_per_video` | 2 000 000 |
| `budget.api_cost_usd_per_video` | 5 |
| `budget.cache_gb` | 20 |
| `music.volume_db` | −18 |
| `music.duck_db` | −12 |
| `asr.wer_threshold.<lang>` | 0.15 `[chờ S12]` |
| `asr.max_regen` | 1 |
| `lipsync.enabled` | false |
| `policy.auto_approve.batch_gen` | false |
| `policy.auto_approve.paid_api` | false |
| `check.duration_tolerance` | 0.10 |
| `meta.title_max` / `meta.description_max` | 100 / 5000 |
| `policy.batch.tts_lines` / `policy.batch.images` | 20 / 5 |
| `policy.paid_api.per_call_usd` | 0.5 |
| `policy.budget_warn_ratio` | 0.8 |
| `gpu.vram_budget_gb.<engine>` / `gpu.vram_total_gb` | comfyui 14 · omnivoice 6 · asr 3 · render 2 / 14 `[chờ S1, S9]` |
