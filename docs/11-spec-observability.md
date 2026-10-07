# D11 — Spec quan sát, eval và chi phí

**Phiên bản:** 1.2 · **Ngày:** 03/10/2026
**Dựa trên:** `00-architecture.md` mục 12, Phụ lục B · **Spike:** S13
**Phủ:** FR-OB-01..04, NFR-07, AC-M3-04 · **Tính năng:** 015 `observability-local`, 028 `cost-report-phoenix`

---

## 1. Trace

- **Chuẩn:** OpenTelemetry; span LLM/tool của agent theo quy ước OpenInference, span khác do app tạo `[chờ S13]`.
- **Lưu:** cục bộ trong `studioflow.db`; giữ `settings.trace.retention_days` ngày.
- **Phoenix (tùy chọn, M3):** khi `settings.trace.phoenix_enabled`, xuất thêm sang Phoenix chạy cục bộ.
- Không bật đồng thời hai nguồn trace cho cùng phiên agent (tránh span trùng).
- Thư viện, endpoint, biến môi trường: tech-defaults.

### 1.1 Span

| Tên span | Cha | Thuộc tính bắt buộc |
|---|---|---|
| `sf.workflow.step` | — (gốc theo video) | `sf.video_id`, `sf.workflow_id`, `sf.step_id`, `sf.attempt`, `sf.step_outcome` (trạng thái bước khi span kết thúc: `done`, `waiting_approval`, `failed`, `skipped`; 050) |
| `sf.refine.round` | `sf.workflow.step` | `sf.round`, `sf.score`, `sf.producer_model`, `sf.critic_model`, `sf.issues.critical/major/minor` |
| `sf.agent.session` | step hoặc gốc chat | `sf.session_kind`, `sf.session_id` |
| (OpenInference LLM/tool) | `sf.agent.session` | theo OpenInference |
| `sf.tool` | `sf.agent.session` | `sf.tool_name`, `sf.ok`, `sf.error_code?` |
| `sf.job` | tool hoặc step | `sf.job_id`, `sf.kind`, `sf.engine`, `sf.from_cache`, `sf.provider` |
| `sf.provider.run` | `sf.job` | `sf.capability`, `sf.provider`, `sf.model`, `sf.gpu_ms?` |
| `sf.text.call` | job/round | `gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `sf.cost_usd` |
| `sf.render` | job | `sf.mode`, `sf.duration_ms`, `sf.output_profile` |

- Ngữ cảnh truyền xuống phiên Agent SDK bằng `TRACEPARENT`; xuống worker qua trường `traceparent` trong JSON-RPC.
- **Nội dung:** prompt/đầu ra LLM chỉ ghi vào span khi `settings.trace.capture_content = true` (mặc định `true`, vì lưu cục bộ). Khóa API luôn bị che.

## 2. Log
JSON mỗi dòng ở `<app-data>/logs/<tiến trình>-<ngày>.log` với trường bắt buộc `ts, level, process, msg` và tùy chọn `trace_id, span_id, video_id, job_id, feature, code`. Khóa bí mật luôn bị che.

## 3. Chi phí

- **Bảng `usage`** trong `studioflow.db`: `ts, channel_id, video_id, step_id, kind ('llm'|'image_api'|'gpu'), provider, model, input_tokens, output_tokens, units, cost_usd, source ('reported'|'estimated')`.
- Giá: `settings.pricing` (D3 mục 6.2), người dùng sửa được. Phiên Claude dùng gói: ghi token, `cost_usd = 0`, `source = 'reported'` khi SDK báo.
- **Ngân sách (FR-OB-03):** trước mỗi lệnh có phí, `core` ước tính; vượt `budget.*` của video → `E_BUDGET_EXCEEDED` + thẻ xác nhận nâng ngân sách. `state.json.budget` cập nhật sau mỗi lệnh.
- **Báo cáo (UI-12):** theo video → bước → loại; xuất CSV.

### 3.1 Số liệu hiệu quả (054)
Bảng trong `studioflow.db` (YouTube Analytics API + Data API; khóa chính làm `INSERT OR REPLACE` nên thu lại cùng ngày là idempotent):
- `channel_metrics(channel_id, platform, day, views, minutes_watched, avg_view_duration_s, subs_gained, subs_lost, likes, fetched_at)` — khóa `(channel_id, platform, day)`; `channel_id` là ID kênh StudioFlow, `day` theo múi giờ báo cáo của YouTube Analytics (Thái Bình Dương).
- `video_metrics(channel_id, platform, video_ref, day, views, minutes_watched, avg_view_duration_s, likes, comments, subs_gained, fetched_at)` — khóa `(channel_id, platform, video_ref, day)`; `video_ref` = ID video trên nền tảng; chỉ video do app đăng (từ kế hoạch ngày).
- `video_stats(channel_id, platform, video_ref, day, view_count, like_count, comment_count, fetched_at)` — ảnh chụp lũy kế của Data API `statistics` mỗi lần thu.
CTR/số lần hiển thị không có trong Analytics API (chỉ ở YouTube Reporting API) — chưa làm.

## 4. Eval nội dung

- **Dữ liệu:** `reviews/*/round-*.json` + quyết định duyệt (`state.json.approvals` kèm ghi chú) + chỉnh sửa người dùng sau duyệt (diff `SCRIPT.md` giữa bản duyệt và bản phát hành).
- **Chỉ số theo kênh:** tỉ lệ duyệt không sửa lớn (G3: diff < 10% số từ), điểm critic trung bình, số vòng trung bình, token/video.
- **So sánh model/rubric:** qua CLI `sf eval compare` (D4 mục 12); chi tiết báo cáo: FN-028.
- Nối số liệu YouTube theo beat: ngoài phạm vi hiện tại.

## 5. Mã lỗi

| Mã | Khi |
|---|---|
| `E_TRACE_STORE` | Không ghi được span (không chặn việc chính; chỉ log) |
| `E_PHOENIX_UNAVAILABLE` | Bật Phoenix nhưng không khởi động được |
