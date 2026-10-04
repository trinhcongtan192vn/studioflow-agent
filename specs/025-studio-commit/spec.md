# Feature Specification: Studio chế độ chỉnh — commit, read-back, frame ghim, file watcher

**Feature Branch**: `025-studio-commit`

**Created**: 2026-10-04

**Status**: Draft

**Input**: Backlog dòng 025: "`studio-commit`: bản làm việc, lọc diff, read-back, file watcher".

**Phủ yêu cầu**: FR-ST-02, FR-ST-03, FR-ST-04, FR-ST-06, FR-WS-06, AC-M3-01, AC-M3-02.

**Dựa trên `docs/`**: D9 mục 1, 3.1–3.6, 4, 5, 7 · D4 mục 2.4 (`studio.open/commit/close`), 3.1 (`NodeStatus.external_change`, `decision_required`), 8.2 (`pinned`, `pinned_stale`) · D3 mục 5.5 (`owner`, `owner_since`, `pinned_frames: ManualDelta`) · D5 mục 4–5 (owner, hỏi khi ghi đè frame ghim) · D10 (IPC `studio.*`) · Spike S6 (chạy trong tính năng này, `research.md`).

## User Scenarios & Testing *(mandatory)*

### US1 — Mở chế độ chỉnh (P1)
`studio.open {mode: 'edit'}` (D9 3.1): có job đang chạy cho video → `E_STUDIO_BUSY`; `owner = 'studio'` + `owner_since`; bản làm việc `.sf/studio-work/<session>/` (chép `index.html`, `compositions/`, `caption-overrides.json`, `hyperframes.json`, `frame.md`, `caption_groups.json`; `public/`, `audio/` là junction); `base.json` (hash file gốc); chạy `hf-studio` trên bản làm việc **sau một proxy cục bộ** chỉ cho phép API chỉnh thuộc tính/keyframe (chặn lưu mã thô, thêm/xóa/bọc/tách phần tử, cài khối, render) — FR-ST-03. Khi `owner = studio`, agent không ghi được file cảnh của video (`E_OWNER_CONFLICT`, FR-ST-06).

### US2 — `studio.commit` (P1) — AC-M3-01, AC-M3-02
1. File gốc đổi ngoài phiên (hash ≠ `base.json`) → `E_BASE_HASH_MISMATCH`, không ghi gì.
2. So DOM (parse HTML, không so chuỗi): ghép phần tử theo `data-sf-id` (phần tử không có id theo vị trí). Cho phép (D9 3.3): `style` chỉ các thuộc tính `left, top, right, bottom, width, height, transform, opacity, z-index`; `data-start`, `data-duration`, `data-*` timing của HyperFrames; `data-color-grading*`, `data-media-*`; `data-volume*`, `data-fade-*`; `data-hf-*` (đánh dấu nội bộ của Studio). Keyframe (D9 3.4 b): `<script>` chỉ đổi giá trị số/chuỗi (cùng chuỗi token). Không cho: thêm/xóa phần tử, đổi thẻ, đổi chữ, đổi `src`, đổi `data-sf-id`, đổi cấu trúc script.
3. Có thay đổi không cho phép → `E_STUDIO_DISALLOWED_CHANGE` kèm danh sách `{file, element_id, attr, reason}`, không ghi gì.
4. `data-sf-id` còn nguyên (không mất, không trùng); `hyperframes lint` bản làm việc không lỗi.
5. Read-back (D9 4): `data-color-grading` đổi → `sf-frame.config.look.id` (frame) trong `STORYBOARD.md`; mức nhạc (`data-volume-db` của phần tử nhạc trong `index.html`) → `music.volume_db` tầng video.
6. Ghi file qua module ghi; frame có thay đổi trình bày → `state.pinned_frames[fr]` (`pinned_at`, `base_hash` = hash bản agent sinh, `changes` gộp với delta cũ); bản ghi graph của frame cập nhật → `pinned`.
7. Trả `{changed_files, pinned_frames, readback_changes}`; mở lại vẫn còn thay đổi; build/sinh lại frame khác không đụng frame đã ghim; agent ghi đè frame ghim phải hỏi người dùng (đã có, D5).

### US3 — Đóng (P1)
`studio.close {discard?}`: còn thay đổi chưa commit và không `discard` → `E_STUDIO_UNCOMMITTED` (UI hỏi người dùng rồi gọi lại); dừng Studio + proxy; xóa bản làm việc; `owner = 'agent'`.

### US4 — Frame ghim lỗi thời (P2) — FR-ST-04
`frame.pinned_decide {frame_id, decision}` (IPC + tool `main`): `keep` → giữ bản chỉnh tay (graph `acceptPinned`); `reapply` → sao lưu, dựng lại frame (phiên `frame`) rồi áp lại từng thay đổi của delta lên phần tử cùng `data-sf-id`; thay đổi không áp được trả về; `discard` → sao lưu, bỏ ghim, dựng lại.

### US5 — File watcher (P2) — FR-WS-06
Theo dõi thư mục video đang mở (file cảnh, `compositions/`, `SCRIPT.md`, `STORYBOARD.md`, `BRIEF.md`): file đổi mà nội dung khác lần ghi gần nhất của app → ghi `.sf/external.json`, phát sự kiện `file.external_change`; `graph.status` báo nút có đầu ra đó là `external_change`. Lần ghi tiếp theo của app qua module ghi xóa đánh dấu.

## Requirements *(mandatory)*
- **FR-001**: `studio/edit.ts` (mở/commit/đóng, bản làm việc, `base.json`), `studio/proxy.ts`, `studio/diff.ts` (DOM + token script, thư viện `parse5`).
- **FR-002**: Tool/IPC `studio.open {mode: 'edit'}`, `studio.commit`, `studio.close {discard?}`; mã `E_STUDIO_UNCOMMITTED`.
- **FR-003**: `frame.pinned_decide` (tool + IPC); áp delta tất định.
- **FR-004**: Watcher + `external_change`.

## Success Criteria
- **SC-001** AC-M3-01: dời vị trí + đổi `data-duration` một phần tử qua API Studio (qua proxy) → commit → file frame có thay đổi, `pinned_frames` có delta, graph `pinned`; mở edit lần 2 vẫn thấy; build frame khác không đổi frame này.
- **SC-002** AC-M3-02: sửa chữ / thêm phần tử / đổi cấu trúc script trong bản làm việc → commit từ chối `E_STUDIO_DISALLOWED_CHANGE` kèm giải thích; API lưu mã thô qua proxy → 403.
- **SC-003**: `reapply` áp lại delta lên frame dựng lại.
- **SC-004**: sửa `SCRIPT.md` bằng tay ngoài app → sự kiện + `external_change`.

## Ngoài phạm vi
CSS ẩn khung sửa mã trong giao diện Studio (proxy chặn lưu là lớp bảo vệ; ẩn UI cần chụp giao diện Studio — để khi có S6 bằng tay), read-back overlay/miệng (027/031), bảng caption (026).
