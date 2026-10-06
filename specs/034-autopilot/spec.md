# Feature Specification: Chế độ tự động (agent điều phối)

**Feature Branch**: `034-autopilot`

**Created**: 2026-10-06

**Status**: Draft

**Input**: Yêu cầu của Tan (2026-10-06): "agent phải là người điều phối và quyết định hầu hết các công đoạn. Chỉ hỏi ở các bước key cần user duyệt (duyệt brief, kịch bản, chọn giọng (khi chưa có sẵn)), các bước còn lại agent có thể tự quyết định cho đến trước bước render".

Quyết định qua MCQ:
- Trước render: giữ điểm duyệt **Hoàn thiện**. Bạn xem bản nháp một lần rồi duyệt để render phát hành.
- Short-film: duyệt **cả bước Truyện**.
- API có phí: **vẫn hỏi**.
- Mặc định: **bật**, tắt được theo kênh hoặc video.

**Phủ yêu cầu**: FR-WF-10 (mới, PRD). Điều chỉnh FR-WF-03 (điểm duyệt) và D5 mục 5.1 (batch_gen).

**Dựa trên `docs/`**: D3 mục 7.2 (khóa cấu hình), D5 mục 5.1 (quyền), D6 mục 3.1 (approval), FN-common.

## User Scenarios & Testing *(mandatory)*

### US1 — Chỉ dừng ở điểm chốt (P1)
Video mới với `workflow.autopilot = true` (mặc định). Agent viết brief, người dùng duyệt brief.

Engine chạy lần lượt các bước:
- Điểm duyệt có trong `workflow.key_approvals` (mặc định `story`, `script`, `finalize`): **dừng** chờ người dùng duyệt.
- Điểm duyệt khác (storyboard, animatic, cast…): engine **tự duyệt** (approval `approved`, ghi chú "Tự duyệt (chế độ tự động)") rồi chạy tiếp.
- Xác nhận "sinh nhiều" (`batch_gen`, miễn phí) được tự đồng ý.
- API có phí (`paid_api`) vẫn hỏi.

### US2 — Thiếu giọng: hỏi đúng một việc (P1)
Tới bước `voice` mà người nói chưa có giọng. Engine không báo lỗi mà giao cho agent:
1. Agent gợi ý 2–3 giọng mỗi người nói (`voice.design`, 033).
2. Agent chờ người dùng chọn.
3. Agent đặt `voice.id` / `voice_id` rồi báo xong.
4. Engine dựng audio và chạy tiếp.

Không có phiên agent (CLI/test) thì báo lỗi gọn như trước (008).

### US3 — Tắt khi muốn duyệt từng bước (P2)
`workflow.autopilot = false` ở kênh hoặc video thì trở lại hành vi cũ: mọi điểm duyệt trong manifest đều dừng.

## Requirements *(mandatory)*

- **FR-001** Khóa cấu hình mới (D3 mục 7.2):
  - `workflow.autopilot`: boolean, tầng app/channel/video, mặc định `true`.
  - `workflow.key_approvals`: string[] (id bước), tầng app/channel/video, mặc định `["story", "script", "finalize"]`.
  - Brief luôn cần người duyệt.
- **FR-002** Engine: bước có `approval.required` và **không** thuộc `key_approvals` khi autopilot bật:
  - Ghi approval `approved` với hash hiện tại và note tự duyệt, bước `done`, chạy tiếp.
  - Approval tự duyệt mà file đổi sau đó: cập nhật hash, không quay về chờ duyệt.
- **FR-003** `PermissionBus`: `batch_gen` được đồng ý tự động khi autopilot bật. `paid_api` và render không đổi.
- **FR-004** Bước `voice` thiếu giọng khi autopilot bật và có agent: giao bước cho agent (chỉ dẫn gợi ý giọng, chờ chọn), xong thì kiểm lại rồi dựng audio.
- **FR-005** Skill `studioflow`: ở chế độ tự động, agent tự quyết mọi lựa chọn không phải điểm chốt, không hỏi người dùng; tóm tắt lựa chọn trong ghi chú bước.
- **FR-006** Tab Tiến độ hiển thị "Tự động" / "Duyệt từng bước" (đọc `config.resolve`).

## Success Criteria *(mandatory)*

- **SC-001** Integration (demo workflow, autopilot bật):
  - Duyệt brief rồi script.
  - Storyboard tự duyệt (approval `approved`, note tự duyệt), không có approval chờ.
  - Engine chạy tới `finalize` thì dừng chờ duyệt.
- **SC-002** Autopilot tắt: storyboard dừng chờ duyệt như cũ.
- **SC-003** `batch_gen` được đồng ý tự động khi bật, vẫn hỏi khi tắt. `paid_api` luôn hỏi.
- **SC-004** Bước voice thiếu giọng khi có agent: agent được giao chỉ dẫn gợi ý giọng; sau khi `voice.id` được đặt và agent báo xong, bước dựng audio thành công.
