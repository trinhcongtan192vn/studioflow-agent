# Feature Specification: Workflow Engine

**Feature Branch**: `007-workflow-engine`

**Created**: 2026-10-03

**Status**: Draft

**Input**: Backlog dòng 007: "manifest, gate, điểm duyệt, `state.json`, khôi phục".

**Phủ yêu cầu**: FR-WF-01 (pha briefing: chọn workflow, brief được duyệt trước khi chạy), FR-WF-02 (tiến độ đọc từ manifest — phần dữ liệu `workflow.state`; UI ở 008), FR-WF-03 (duyệt / yêu cầu sửa / quay lại), FR-WF-04 (gate: artifact hợp lệ, không còn nút lỗi thời, đã duyệt), FR-WS-04 (khôi phục khi mở lại).

**Dựa trên `docs/`**: D6 mục 1 (gói workflow, `workflow.yaml`), 2 (thư viện bước: người thực hiện, Đọc/Ghi, gate mặc định), 3 (engine: briefing, vòng đời bước, approval, rewind, khôi phục, điều phối tự động), 4.2 (kiểm tra khách quan — phần không cần LLM), 9 (mã lỗi) · D4 mục 2.4 (`workflow.*`, `approval.annotate`), 3.1 (`VideoStateSummary`) · D3 mục 5.2, 5.10 (`BRIEF.md`, `state.json`, `Approval`) · D13 (`app_api`, `sf ext validate`).

## Bối cảnh & mục tiêu

Workflow là gói dữ liệu (manifest + skill); engine trong `core` đọc manifest và điều phối: chạy bước engine (gọi capability/graph), giao bước agent cho phiên agent và chờ `workflow.step_complete`, kiểm gate, tạo điểm duyệt, quay lại, khôi phục sau khi tắt app. Không có mã riêng cho từng workflow.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Pha briefing và chọn workflow (Priority: P1) — FR-WF-01
1. **Given** video `phase: briefing`, **When** `workflow.list`, **Then** trả workflow đã cài và tương thích (`app_api`, capability bắt buộc có provider); gói không tương thích không có trong danh sách (lý do ghi log).
2. **When** `workflow.select {workflow_id, output_profile}`, **Then** `BRIEF.md` có `proposed_workflow`, `proposed_output_profile`; engine tạo approval cho bước `brief` với hash `BRIEF.md`.
3. **When** người dùng duyệt brief, **Then** `state.json`: `workflow`, `output_profile`, `steps` (mọi bước `pending`), `phase: workflow`; `BRIEF.md.approved_at` được đặt.
4. **Given** `phase: workflow`, **When** `workflow.select`, **Then** lỗi (đổi workflow cần quay về briefing — chỉ khi người dùng xác nhận).

### User Story 2 - Chạy bước, gate, điểm duyệt (Priority: P1) — FR-WF-03/04
1. Bước bắt đầu khi mọi `after` (mặc định: bước trước) `done`; `skip_if` đúng → `skipped`.
2. Bước engine chạy executor đăng ký theo `uses` (ví dụ `voice` → `graph.build` `audio.line` + `audio_meta`); bước agent gửi chỉ dẫn chuẩn cho phiên agent và chờ `workflow.step_complete`; agent dừng mà chưa báo → `failed` `E_STEP_INCOMPLETE`.
3. Sau khi chạy: kiểm gate mặc định của bước + gate khai báo; không qua → `failed` `E_GATE_FAILED` kèm kết quả từng gate; qua → `approval.required` ? `waiting_approval` (approval kèm `artifact_hashes` của đầu ra) : `done`.
4. Duyệt `approved` → `done` và engine chạy tiếp; `changes_requested` + ghi chú → bước về `running` với ghi chú làm đầu vào.
5. `approval.annotate {step_id, summary}` gắn tóm tắt vào approval đang chờ của bước.
6. Hash artifact trong approval đã duyệt đổi → approval về `pending`, bước về `waiting_approval`.

### User Story 3 - Điều khiển qua chat (Priority: P1) — FR-WF-03
1. `workflow.run_to {step_id}` chạy liên tiếp tới hết bước đích (dừng ở duyệt/lỗi/xác nhận).
2. `workflow.pause` dừng sau bước đang chạy.
3. `workflow.rewind {step_id}`: bước đích về `running`, mọi bước sau `stale`.
4. `workflow.gate_check {step_id}` → `{pass, results[]}` không đổi trạng thái.
5. `workflow.state` → `VideoStateSummary` (D4 mục 3.1).

### User Story 4 - Khôi phục (Priority: P1) — FR-WS-04
1. **Given** app tắt khi bước engine `running`, **When** mở lại, **Then** bước được chạy lại (executor idempotent: graph + cache).
2. **Given** bước agent `running`, **Then** đặt `pending` và đánh dấu cần người dùng xác nhận chạy lại.
3. Approval đang chờ giữ nguyên.

### User Story 5 - Kiểm manifest (Priority: P2)
1. `sf ext validate <pack_dir>`: schema `WorkflowManifest`, plugin.json, `app_api`, id bước trùng, `after` trỏ bước lạ, `E_STEP_ORDER` (bước đọc dữ liệu do bước sau ghi, theo bảng Đọc/Ghi D6 mục 2).

### Edge Cases
- Manifest có vòng phụ thuộc → lỗi validate.
- Bước có `uses` chưa có executor (tính năng chưa làm) → `failed` `E_WORKFLOW_INCOMPATIBLE` rõ ràng.
- Gate `graph_fresh` với mẫu `audio.line:*`, `*`.

## Requirements *(mandatory)*
- **FR-001**: Nạp gói từ `<app-data>/extensions/workflows/` rồi `<install>/extensions/workflows/` (gói người dùng ưu tiên khi trùng id), kiểm schema `WorkflowManifest`, `app_api` (semver range so với `APP_API`), `requires` có provider.
- **FR-002**: Bảng thư viện bước D6 mục 2 (người thực hiện, Đọc/Ghi, gate mặc định) là một nguồn trong code; `validateManifest` kiểm thứ tự dữ liệu (`E_STEP_ORDER`), vòng, id trùng.
- **FR-003**: Engine theo D6 mục 3: briefing, vòng đời bước, approval do engine tạo duy nhất, `changes_requested`, rewind, approval mất hiệu lực khi hash đổi, điều phối tự động, khôi phục.
- **FR-004**: Gate `artifact_valid`, `graph_fresh`, `approved`, `script` (script khai báo trong manifest qua cơ chế `script.run`), `objective` (`schema`, `coverage`, `meta_limits`; các kiểm cần mục tiêu độ dài ở 009).
- **FR-005**: Registry executor bước engine theo `uses` (tính năng sau đăng ký); executor `voice` dùng `graph.build`.
- **FR-006**: Bước agent: engine gọi `AgentStepRunner` (gắn phiên `main` ở 008) với chỉ dẫn chuẩn D6 mục 2; chờ `workflow.step_complete`.
- **FR-007**: Tool `workflow.list/select/state/run_to/pause/rewind/step_complete/gate_check`, `approval.annotate`; API duyệt (`approve`, `requestChanges`) cho IPC (008); sự kiện `workflow.updated`.
- **FR-008**: Mọi ghi `state.json`/`BRIEF.md` qua module ghi (kiểm schema).
- **FR-009**: CLI `sf ext validate <pack_dir>`, `sf workflow list`, `sf workflow state --channel --video`.

## Success Criteria *(mandatory)*
- **SC-001**: Workflow mẫu (fixture) chạy từ brief tới hết bằng executor/agent giả với đủ điểm duyệt, rewind, changes_requested.
- **SC-002**: Giết `core` giữa bước engine → mở lại hoàn tất đúng (test tiến trình thật).
- **SC-003**: Độ phủ dòng core ≥ 80%.

## Phạm vi
**Trong**: nạp/kiểm gói, engine, gate, tool, CLI, executor `voice`.
**Ngoài**: `refine-loop` và kiểm `length`/`read_time`/`banned_terms` (009), executor `script`/`publish-meta` (009), `frame-build` (011), `captions` (010), `music` (012), `render` (013), gói `narrated-explainer` thật (016), UI tiến độ (008), `sf ext build`/delta (khi có gói fork, 016).

## Assumptions
- `APP_API = 1.0.0`; `APP_PHASE = 'M1'` (bước `skip_if: {phase_before: M3}` bị bỏ qua).
- Bước agent chưa có runner (CLI, test) → `failed` `E_STEP_INCOMPLETE` với lý do "no agent session".
