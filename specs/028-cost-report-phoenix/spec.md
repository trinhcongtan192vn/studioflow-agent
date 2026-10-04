# Feature Specification: Báo cáo chi phí, Phoenix, eval so sánh, chọn ngữ cảnh từ xem trước

**Feature Branch**: `028-cost-report-phoenix`

**Created**: 2026-10-04

**Status**: Draft

**Input**: Backlog dòng 028: "`cost-report-phoenix` + chọn ngữ cảnh từ preview".

**Phủ yêu cầu**: FR-OB-03, FR-OB-04, FR-CH-04, AC-M3-04.

**Dựa trên `docs/`**: D11 mục 1 (trace, Phoenix), 3 (bảng `usage`, ngân sách, báo cáo), 4 (eval) · D10 UI-08, UI-12, mục 4 (`cost.report`, `chat.send`) · D5 mục 1 (`ContextRef`) · D4 mục 12 (`sf eval compare`) · tech-defaults mục 5 (OTLP HTTP `127.0.0.1:6006`) · FN-028, FN-008.

## User Scenarios & Testing *(mandatory)*

### US1 — Báo cáo chi phí (P1, FR-OB-03) — AC-M3-04
Bảng `usage` (D11 mục 3) được ghi **từ span khi kết thúc** (cùng nguồn với trace): `sf.text.call` và `sf.agent.session` → `llm` (token, chi phí báo cáo; gói Claude = 0); `sf.provider.run` không trúng cache → `gpu` (giây chiếm GPU) và `image_api` (provider `per_image`, giá ước tính theo `settings.pricing`). Bước/video lấy từ span tổ tiên (`sf.workflow.step`). Tab **Chi phí** (UI-12): video → bước → loại (LLM, API ảnh, GPU), token vào/ra, chi phí, thời gian GPU, so ngân sách video; **Xuất CSV**.

### US2 — Phoenix (P2, FR-OB-04)
Cài đặt → "Gửi trace sang Phoenix": có Phoenix ở `127.0.0.1:6006` → xuất OTLP HTTP; không có → chạy `phoenix serve` của môi trường app (`phoenix-env`); không được → `E_PHOENIX_UNAVAILABLE` (trace vẫn lưu SQLite). Tab Trace có "Mở trong Phoenix" khi bật.

### US3 — Eval so sánh (P2)
`sf eval compare --channel --by producer_model|rubric_version [--since] [--step]`: tỉ lệ duyệt không sửa lớn (G3: số từ khác < 10% giữa bản duyệt và bản hiện tại), điểm critic trung bình, số vòng trung bình, token/video.

### US4 — Ngữ cảnh từ xem trước (P1, FR-CH-04)
Trong Xem trước: "Đính kèm mốc hiện tại" (mốc đầu phát Studio) và "Đính kèm phần tử đang chọn" (phần tử có `data-sf-id` → `element`; không có → `frame` theo file frame); bảng caption: "Đính kèm vào chat" cho cụm đang chọn. Chip trên ô chat, bỏ từng chip; `chat.send` gửi `context_refs` (D5).

## Requirements *(mandatory)*

- **FR-001** Bảng `usage` theo D11 (+ `span_id`, `trace_id` để đối chiếu); ghi trong exporter span.
- **FR-002** IPC `cost.report {channel, video}` → báo cáo + CSV; `trace.phoenix {enabled}`.
- **FR-003** `sf.provider.run` có `sf.gpu_ms` (thời gian chạy adapter khi giữ lease engine), `sf.cost_kind`, `sf.units`.
- **FR-004** Studio xem trước đi qua proxy chỉ đọc (chỉ chọn/thăm dò) + trang cầu nối cùng origin (research R3).

## Success Criteria *(mandatory)*

- **SC-001 (AC-M3-04)** Tổng token/chi phí của báo cáo = tổng thuộc tính `gen_ai.usage.*`/`sf.cost_usd` của span trace (+ ước tính ảnh); theo bước đúng.
- **SC-002** CSV có dòng bước × loại + tổng.
- **SC-003** Bật Phoenix → máy chủ OTLP nhận `POST /v1/traces`; tắt → không gửi.
- **SC-004** `eval compare` theo model/rubric cho đúng chỉ số trên dữ liệu mẫu.
- **SC-005** UI: bấm "Đính kèm mốc hiện tại" → chip "Mốc x,xx s"; tab Chi phí hiện bảng.
