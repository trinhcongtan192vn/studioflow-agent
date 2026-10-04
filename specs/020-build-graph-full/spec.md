# Feature Specification: Build graph đầy đủ

**Feature Branch**: `020-build-graph-full`

**Created**: 2026-10-04

**Status**: Draft

**Input**: Backlog dòng 020: "đủ loại nút (`asset`, `frame_html`, `lipsync.line`, `credits`, `render`), nút ghim, `graph.plan` có ước tính".

**Phủ yêu cầu**: AC-M2-02, AC-M2-03.

**Dựa trên `docs/`**: D4 mục 3.1 (`NodeStatus`, `PlannedJob`, `PlanEstimate`), 7 (khóa cache), 8.1–8.3 (nút, trạng thái, lan truyền, mô hình thời gian, `pinned_stale`) · D3 mục 4 (`Layer.asset_request`), 5.5 (`state.pinned_frames: ManualDelta`), 5.13 (asset), 6 (`settings.pricing`) · D9 mục 5 (frame ghim) · D6 mục 5 (frame packet) · FN-018/023 (kích thước ảnh, seed theo scene).

## User Scenarios & Testing *(mandatory)*

### US1 — Nút `asset` (P1) — AC-M2-03
1. Mỗi layer `asset_request.source = generate` chưa có `asset_id` → nút `asset:<el>` (pha `image`): `image.generate` với prompt, ảnh tham chiếu, `transparent`, kích thước theo `aspect` (16:9 → 1664×928, 9:16 → 928×1664, 1:1 → 1328×1328, 4:3 → 1472×1104; trong suốt không có aspect → 1024×1024), look của scene/frame, **seed cố định theo scene**, provider `provider.image.generate`.
2. Kết quả: asset kênh + `public/<as>.png`; `meta.asset_id`. Frame packet coi asset đó là asset của layer.
3. Đổi provider ảnh (local ↔ API) → các nút `asset` `stale`, sinh lại khi build.

### US2 — Nút `frame_html` và frame ghim (P1) — AC-M2-02
1. Mỗi frame → `frame_html:<fr>` phụ thuộc `frame_timing` và `asset` của layer; đầu vào = frame packet với thời lượng/mốc làm tròn theo video frame (fps của output profile) → đổi thời lượng ≤ 1 video frame không làm frame lỗi thời.
2. Build: file frame hợp lệ chưa có bản ghi → nhận vào graph (không sinh lại); thiếu/lỗi thời → phiên `frame` (frame sub-agent, 011) sinh lại đúng frame đó. Bước `frame-build` của workflow ghi nhận frame đã dựng vào graph.
3. `state.pinned_frames` có frame → `pinned` (đầu vào chưa đổi từ lúc ghim) hoặc `pinned_stale` (`decision_required`), không lập job; `acceptPinned` (giữ bản chỉnh tay) cập nhật `input_hash` → `pinned`.
4. AC-M2-02: sửa chữ một line → kế hoạch chỉ gồm `audio.line`/`asr.line` của line đó, `audio_meta`, `captions`, `frame_timing`, `frame_html` của frame chứa line (nếu thời lượng đổi > 1 frame), `index`.

### US3 — `credits`, `render`, `lipsync.line` (P2)
1. `credits` → `.sf/CREDITS.txt` từ nhạc + asset đã dùng có attribution (cùng định dạng 013).
2. `render`: render nháp từ `index` + output profile; **chỉ chạy khi được chọn làm mục tiêu** (`graph.build {targets:['render']}`); `fresh` khi render nháp xong gần nhất có `index_hash` = hash `index.html` hiện tại.
3. `lipsync.line`: loại nút + pha `lipsync` có sẵn; chỉ hoạt động khi có builder (032).

### US4 — `graph.plan` có ước tính (P2)
`PlannedJob.engine`, `est_ms` (trung bình lịch sử theo loại), `est_cost_usd` (provider `cost.kind ≠ free`: `settings.pricing` theo provider/đơn vị `image`, không có → `policy.paid_api.per_call_usd`), `from_cache` (khóa cache đã có trong `cache/objects` — `audio.line`, `asset`); `estimate.cached_count`.

### Edge Cases
- Video không có workflow/agent runtime → `frame_html` lỗi thời báo `E_STEP_INCOMPLETE` gợi ý chạy bước frame-build.
- Asset sinh lỗi → nút `failed`, frame phụ thuộc `skipped`.

## Requirements *(mandatory)*
- **FR-001**: Loại nút `asset`, `frame_html`, `lipsync.line`, `credits`, `render`; pha; thứ tự lắp `audio_meta → captions → frame_timing → frame_html → index → credits → render` (credits đọc index + frame).
- **FR-002**: Builder `asset` (dịch vụ ảnh 018), `frame_html` (bộ dựng lại frame do WorkflowService cung cấp), `credits`, `render`.
- **FR-003**: Trạng thái `pinned`/`pinned_stale` + `decision_required` + `acceptPinned`.
- **FR-004**: Nút chỉ-chạy-khi-chọn (`render`).
- **FR-005**: Planner theo loại nút (`engine`, `from_cache`, `cost_usd`) cho `graph.plan`.
- **FR-006**: Frame packet dùng asset từ nút `asset`; `frame-build` dựng `asset` trước và ghi nhận `frame_html` vào graph.

## Success Criteria
- **SC-001**: AC-M2-02 trên video mẫu 2 frame (TTS giả): kế hoạch sau khi sửa một line đúng tập nút; frame còn lại không lỗi thời.
- **SC-002**: AC-M2-03: đổi `provider.image.generate` → `asset` `stale`; build lại tạo asset mới.
- **SC-003**: `graph.plan` báo `from_cache` cho line có sẵn trong cache và chi phí cho provider ảnh có phí.

## Ngoài phạm vi
UI quyết định frame ghim và áp lại chỉnh tay (025), builder lipsync (032), video 10 phút thật (AC-M2-02 đo trên video mẫu ngắn; số nút độc lập độ dài).
