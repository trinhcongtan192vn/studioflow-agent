# Feature Specification: Lịch GPU theo pha

**Feature Branch**: `019-gpu-scheduler-phases`

**Created**: 2026-10-04

**Status**: Draft

**Input**: Backlog dòng 019: "gpu-scheduler-phases".

**Phủ yêu cầu**: FR-OP-02 ("GPU PHẢI chạy một job nặng một lúc, theo pha (TTS → ảnh → render)").

**Dựa trên `docs/`**: D4 mục 4.1 (`resource`, `engine` trong manifest), 4.2 (`release('offload'|'unload')`), 5 (hàng đợi job), 6 (lịch GPU: quy tắc 1–5, ngân sách VRAM), 8.3 (kế hoạch theo pha) · D3 mục 7.2 (`gpu.vram_budget_gb.<engine>`, `gpu.vram_total_gb`) · tech-defaults (cửa sổ gom 3 s; ngân sách comfyui 14 · omnivoice 6 · asr 3 · render 2 / tổng 14).

## User Scenarios & Testing *(mandatory)*

### US1 — Một job nặng một lúc (P1)
1. Engine có lớp tài nguyên lấy từ manifest provider (`resource` của provider có `engine`); `render` là `gpu-light`; engine không có provider GPU (download, audio-analysis, CPU, network) không bị lịch GPU giới hạn.
2. `gpu-heavy` (comfyui) chỉ chạy khi không engine GPU nào khác đang chạy; `gpu-light` chạy cùng nhau khi tổng ngân sách các engine đang chạy ≤ `gpu.vram_total_gb` và không có `gpu-heavy` đang chạy.
3. Giới hạn áp cho **mọi** lần dùng GPU: job trong hàng đợi có `engine` và lời gọi provider bên trong job khác (ví dụ `graph.build` gọi OmniVoice/ASR, ảnh trong bước workflow) — cùng một bộ lịch.
4. Cùng engine được vào lại (job của engine E gọi provider engine E không tự chặn).

### US2 — Giải phóng VRAM khi đổi engine (P1)
1. Engine đã chạy xong vẫn "giữ VRAM" (model còn nạp) nếu provider có `release`. Trước khi chạy engine E mà engine đang giữ VRAM không vừa (tổng ngân sách vượt, hoặc E/engine kia là `gpu-heavy`) → gọi `release('offload')` của provider engine đó rồi mới chạy E (ComfyUI `/free`, worker Python `offload`).
2. Lỗi khi release → ghi log, vẫn chạy (không chặn).

### US3 — Chọn job (P2)
Ưu tiên (2 > 1 > 0) → cùng engine đang nóng → thứ tự tạo (đã có ở 004, giữ nguyên); job không chạy được vì GPU bận nằm chờ, không chiếm chỗ.

### US4 — Gom thay đổi lẻ (P2)
`graph.build`/`tts.synthesize` từ tool: job `graph.build` của cùng video còn `queued` → gộp mục tiêu vào job đó (trả cùng `job_id`); job mới chờ cửa sổ gom (tech-defaults 3 s) trước khi chạy.

### Edge Cases
- Hủy khi đang chờ GPU → bỏ chờ ngay, job `canceled`.
- Ngân sách một engine > tổng → vẫn chạy được khi GPU trống (không treo).

## Requirements *(mandatory)*
- **FR-001**: `GpuScheduler` (`jobs/gpu.ts`): lớp tài nguyên + ngân sách theo engine (cấu hình tầng app), `tryAcquire`/`acquire(engine, signal)` → lease, re-entrant cùng engine, hàng chờ FIFO, sự kiện `released`.
- **FR-002**: Đẩy VRAM: theo dõi engine giữ VRAM; `release('offload')` qua hook (registry provider theo engine) trước khi chạy engine không vừa.
- **FR-003**: Hàng đợi job dùng lịch GPU (không khởi chạy job có engine GPU khi không vừa; chạy lại khi lease được trả); `runCapability` lấy lease cho provider có `engine` GPU; job `render` lấy lease `render`.
- **FR-004**: Gom `graph.build` (gộp mục tiêu vào job queued cùng video, cửa sổ `CoreOptions.batchWindowMs`, mặc định 3 000 ms; test đặt 0 qua `SF_BATCH_WINDOW_MS`).
- **FR-005**: Span `sf.gpu.wait` khi phải chờ GPU (D11), thuộc tính engine + ms chờ.

## Success Criteria
- **SC-001**: Kịch bản omnivoice đang chạy + job comfyui xếp hàng: comfyui chỉ bắt đầu sau khi omnivoice trả lease, `release('offload')` của omnivoice được gọi trước khi comfyui chạy; hai engine light (omnivoice 6 + asr 3 ≤ 14) chạy song song.
- **SC-002**: 3 lời gọi `tts.synthesize` cách nhau < cửa sổ → 1 job `graph.build` với mục tiêu hợp.

## Ngoài phạm vi
Đo VRAM thật để tự chỉnh ngân sách (`[chờ S1, S9]`), ước tính thời gian `graph.plan` (020), UI hiển thị hàng chờ GPU.
