# Feature Specification: Lip-sync mức 1

**Feature Branch**: `032-lipsync-level1`

**Created**: 2026-10-05

**Status**: Draft

**Input**: Backlog dòng 032: "`lipsync-level1`".

**Phủ yêu cầu**: FR-WF-09, AC-M5-01 (phần M5b: miệng nhân vật khớp nhịp ở shot trung/cận).

**Dựa trên `docs/`**: D3 mục 5.6 (`Frame.lipsync {cast_id, mouth_anchor}`, layer `kind: mouth`, `CastMember.mouth_set/mouth_anchor`), 5.9 (`LipsyncCues`), 7.2 (`lipsync.enabled`), D4 mục 2.4 (`lipsync.cues`), 4.3 (`lipsync.amplitude`, node), 8.1 (`lipsync.line`, `frame_html` có lipsync), D6 mục 2 (`lipsync`), D13 mục 6 (`mouths/<set>/<view>/{closed,half,open}.svg`), FN-031/032 mục 4–5.

## User Scenarios & Testing *(mandatory)*

### US1 — Miệng khớp lời ở shot trung/cận (P1)
`lipsync.enabled` bật (kênh/video/frame); storyboard khai `lipsync` cho shot có nhân vật nói (layer `mouth` đặt tại miệng). Bước `lipsync` tính cue cho line của nhân vật đó: RMS mỗi video frame chuẩn hóa theo đỉnh của line, ngưỡng half 0,15 / open 0,35, đoạn < 2 frame nhập vào đoạn trước → `lipsync/<ln>.json`. Khi dựng frame, app chèn ba ảnh miệng (bộ miệng của nhân vật, mặc định `flat`, góc `front`) vào layer `mouth` và đổi ảnh theo cue trên timeline của frame. Shot không khai `lipsync`: không khẩu hình.

## Requirements *(mandatory)*

- **FR-001** Provider `lipsync.amplitude` (node, CPU) — capability `lipsync.cues`, cache theo hash audio + fps + ngưỡng.
- **FR-002** Nút `lipsync.line` cho line của `lipsync.cast_id` trong frame bật; builder ghi `LipsyncCues`.
- **FR-003** Phần hoàn thiện của `frame_html`: cue + bộ miệng → chèn miệng (đánh dấu `sf:mouth`, script `data-sf-lipsync`), idempotent; đổi cue không gọi lại agent; `frame_html` phụ thuộc nút `lipsync.line` của frame.
- **FR-004** Executor `lipsync`, tool `lipsync.cues {line_ids}`, objective `lipsync_anchors` (cast có nói trong shot, anchor là layer `mouth`, có bộ miệng).
- **FR-005** Packet: quy tắc đặt layer miệng (rỗng, tại miệng nhân vật, theo `CastMember.mouth_anchor` nếu có).
- **FR-006** Bộ miệng mặc định `extensions/styles/core-mouths/mouths/flat/{front,three_quarter}/`.

## Success Criteria *(mandatory)*

- **SC-001** E2E short-film (bật lip-sync): bước `lipsync` xong, một file cue cho line của Mai ở shot trung, có trạng thái `open`, kết `closed`; frame có ảnh miệng trong layer `mouth` và timeline đổi ảnh; render phát hành qua lint/check.
- **SC-002** Unit: im lặng/to/vừa → closed/open/half/closed đúng frame; nhấp nháy 1 frame bị bỏ; chèn/gỡ miệng idempotent.
