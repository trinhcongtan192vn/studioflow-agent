# Feature Specification: Kiểm tra lại bước đã sửa tay; kịch bản thoại bền hơn

**Feature Branch**: `036-step-recheck`

**Created**: 2026-10-06

**Status**: Draft

**Input**: Lỗi ở bước Script của video "Cậu bé và con trâu" (Tan: "xử lý luôn lỗi đang gặp phải ở bước Script"). Diễn biến:
1. Producer dùng người nói `ca_on4x8d1w`, không có trong CAST.md, nên gate `speakers_voiced` báo lỗi.
2. Agent sửa SCRIPT.md, gate đã qua, nhưng bước `failed` không có cách chấp nhận bản sửa: `run_to` lặng lẽ không làm gì, còn "Chạy lại" sinh lại và **ghi đè** bản đã sửa.
3. Lần sinh lại đặt marker `sf:beat` trên dòng riêng. Lỗi phân tích bị ném ra trong gate, nên bước **kẹt ở running**.

**Phủ yêu cầu**: FR-WF-03 (vòng đời bước), FR-SC-02 (kiểm khách quan), FR-WF-08.

## Requirements *(mandatory)*

- **FR-001** `engine.recheck(step)` + tool `workflow.recheck` (phiên main) + IPC: chạy gate trên file hiện có, không gọi executor/agent.
  - Qua: xử lý như bước vừa xong (điểm duyệt / tự duyệt 034 / xong) rồi chạy tiếp.
  - Không qua: bước `failed` kèm kết quả từng gate.
  - Chỉ áp dụng khi các bước trước đã xong và bước đang `failed`, `pending` hoặc `stale`.
- **FR-002** `runTo(step)` có bước `failed` phía trước: ném `E_STEP_ORDER` kèm hướng dẫn (chạy lại hoặc sửa file rồi `recheck`).
- **FR-003** `evaluateGate` không bao giờ ném: lỗi bất ngờ thành gate không qua (bước `failed`, không kẹt `running`).
- **FR-004** Kịch bản thoại: kiểm khách quan `speakers_known` trong refine. Người nói phải là `narrator` hoặc nhân vật trong CAST.md hay cấp kênh; chi tiết lỗi liệt kê các id hợp lệ để vòng sau tự sửa.
- **FR-005** `stripWrapping`: marker `sf:beat` viết trên dòng riêng (trước hoặc ngay sau tiêu đề) được gắn vào tiêu đề.
- **FR-006** Thành viên CAST có `role: narrator` mà không có `voice_id` thì dùng `voice.id` (giọng người dẫn).
- **FR-007** UI:
  - Bước lỗi: nút **Kiểm tra lại** (chính), **Chạy lại** (hỏi xác nhận vì viết đè), **Quay lại**.
  - Thẻ lỗi gate trong chat có "Kiểm tra lại".
  - Skill: dùng `workflow.recheck` sau khi sửa file.

## Success Criteria *(mandatory)*

- **SC-001** Integration (demo, kịch bản hỏng):
  - `runTo(storyboard)` ném `E_STEP_ORDER`.
  - `recheck` khi chưa sửa: không qua, executor không chạy lại.
  - Sửa SCRIPT.md rồi `recheck`: qua, bước `waiting_approval`, file giữ nguyên.
  - Tool `workflow.recheck` trên bước chưa tới lượt: `E_STEP_ORDER`.
- **SC-002** Unit: `speakers_known`; gắn marker beat; `evaluateGate` không ném.
