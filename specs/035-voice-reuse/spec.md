# Feature Specification: Dùng lại giọng và nhân vật có sẵn của kênh

**Feature Branch**: `035-voice-reuse`

**Created**: 2026-10-06

**Status**: Draft

**Input**: Tan hỏi bước kịch bản thoại có biết giọng đã có trong thư mục dự án không. Kiểm tra cho thấy phiên agent làm việc trong phạm vi thư mục video, nên **không đọc được** `voices/` và `characters/` cấp kênh, và cũng không có công cụ liệt kê. Agent vì vậy luôn tạo giọng mới. Tan: "ok xử lý ngay".

**Phủ yêu cầu**: FR-VO-07 (mới). Bổ sung FR-VO-05/06, FR-WF-08.

**Dựa trên `docs/`**: D3 mục 2 (`voices/<vo>/`, `characters/<ca>/cast.json`), mục 4 (`CastMember`); D4 mục 2.4 (tool `voice.*`); D6 (bước `cast`); FN-031 mục 3.

## User Scenarios & Testing *(mandatory)*

### US1 — Nhân vật cũ tự dùng lại giọng (P1)
Video mới của kênh có nhân vật đã xuất hiện ở video trước (`characters/ca_…/cast.json` có `voice_id`). Ở bước `cast`, agent gọi `cast.list`, thấy nhân vật đó, rồi ghi **đúng mã `ca_…`** vào CAST.md. Giọng, ảnh chuẩn và biểu cảm được dùng lại, không hỏi người dùng.

### US2 — Nhân vật mới: giọng sẵn có được đưa ra trước (P1)
Nhân vật mới chưa có giọng. Agent gọi `voice.list` và thấy các giọng của kênh (đã clone hoặc gợi ý), kèm "dành cho ai" và "đang được ai dùng". Giọng nào phù hợp (giới tính, tuổi, `suggested_for`) thì agent đưa ra làm phương án để người dùng chọn. Chỉ tạo giọng mới (`voice.design`) khi không có giọng phù hợp.

### US3 — Người dẫn
`voice.list` cho biết `voice.id` hiện tại của kênh/video. Đã có thì người dẫn dùng giọng đó.

## Requirements *(mandatory)*

- **FR-001** Tool `voice.list {}` (phiên main, chỉ đọc), trả về `{narrator_voice_id, voices[]}`. Mỗi giọng gồm:
  - `voice_id`, `name`, `language`, `kind` (`cloned` | `designed`), `ready` (có `voice.pt`);
  - `design?`, `suggested_for?`, `created_at`;
  - `used_by[]`: `narrator` khi là `voice.id` hiện tại, các `ca_…` có `voice_id` trùng.
- **FR-002** Tool `cast.list {}` (phiên main, chỉ đọc), trả về nhân vật cấp kênh `characters/*/cast.json`:
  - `id`, `name`, `voice_id?`, `voice_name?`, `caption_color?`;
  - số `reference_images`, các khóa `expressions`.
- **FR-003** Skill `studioflow` (Giọng đọc) và `short-film` (bước cast): gọi `cast.list` và `voice.list` trước, dùng lại theo US1–US3; bỏ chỉ dẫn sai "đọc `characters/…` bằng artifact.read".
- **FR-004** Chỉ dẫn bàn giao bước voice khi thiếu giọng (034) nhắc agent xem `voice.list` trước.

## Success Criteria *(mandatory)*

- **SC-001** Integration: kênh mẫu có `vo_c3z8p1mn` (người dẫn và `ca_a7f2k9wd`) cùng một giọng gợi ý mới.
  - `voice.list` trả đủ hai giọng, `used_by` đúng, `kind` đúng.
  - `cast.list` trả `ca_a7f2k9wd` với `voice_id` và `voice_name`.
- **SC-002** Contract: hai tool chỉ cho phiên `main`.
- **SC-003** CAST.md dùng lại `ca_a7f2k9wd` mà không ghi `voice_id`: gate `speakers_voiced` vẫn qua, vì giọng lấy từ nhân vật cấp kênh.
