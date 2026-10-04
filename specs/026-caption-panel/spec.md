# Feature Specification: Bảng caption — kéo mép, tách/gộp, sửa chữ, audio và dạng sóng

**Feature Branch**: `026-caption-panel`

**Created**: 2026-10-04

**Status**: Draft

**Input**: Backlog dòng 026: "`caption-panel`".

**Phủ yêu cầu**: FR-ST-05, AC-M3-03.

**Dựa trên `docs/`**: D9 mục 6 (hợp đồng bảng caption), 3.1 (khóa chỉ đọc khi Studio chỉnh) · D3 mục 5.8 (`CaptionGroups`, `CaptionOverrides`, override `orphan`) · D4 mục 3.1 (`NodeStatus.orphan`), 8.1 (`index` nhận overrides) · D10 UI-11, mục 4 (`captions.load` / `captions.save`, sự kiện `artifact.changed`) · FN-026 (gợi ý tương tác).

## User Scenarios & Testing *(mandatory)*

### US1 — Mở bảng caption (P1)
Dưới khung Xem trước (UI-11) có bảng caption: trình phát audio bản ghép lời đọc, dạng sóng (đỉnh mỗi 10 ms), các cụm caption trên trục thời gian, chữ caption đang đọc chạy theo đầu phát. `captions.load` đọc `caption_groups.json`, `caption-overrides.json`, `audio_meta.json`; sinh (dẫn xuất) `.sf/preview/voice.wav` (ghép `audio/lines` theo mốc chuỗi lời đọc) + `.sf/preview/waveform.json`, chỉ sinh lại khi audio các line đổi. Trả cụm **sau khi áp override**, `base_hash` của `caption-overrides.json`, từ của từng line, `read_only` (`owner = studio`), danh sách override `orphan`.

### US2 — Chỉnh và lưu (P1) — AC-M3-03
1. Kéo mép trái/phải cụm: bước 10 ms, bám mốc từ trong ±40 ms; không chồng lên cụm kề cùng line (chặn tại mép cụm kề); kẹp trong khoảng audio của line; giữ `start < end`.
2. Tách cụm tại một từ (từ đó là đầu cụm mới); gộp cụm với cụm kề sau cùng line.
3. Sửa chữ hiển thị của cụm (không đổi lời đọc — đổi lời đọc thì sửa qua chat).
4. Phím: Space phát/dừng, ←/→ nhảy cụm, Ctrl+Z/Ctrl+Y hoàn tác/làm lại.
5. Tự lưu sau 1 giây không thao tác: `captions.save {overrides, base_hash}` → ghi duy nhất `caption-overrides.json` qua `artifact.write` (Gateway kiểm schema, owner, `base_hash`). Không đổi `SCRIPT.md`, không đổi audio.
6. Bất biến khi lưu (D9 6): cụm cùng line không chồng nhau; `start_ms < end_ms`; mốc trong khoảng audio của line; tách/gộp phải áp được — vi phạm → `E_SCHEMA_INVALID` kèm danh sách, không ghi.
7. Xung đột `base_hash` → `E_BASE_HASH_MISMATCH`; bảng tải lại và báo người dùng.
8. Sau khi lưu: nút `index` lỗi thời; build lại → `compositions/captions.html` (đầu vào render) dùng mốc/chữ mới.

### US3 — Chỉ đọc và orphan (P2)
- `owner = studio` → bảng chỉ đọc (nút chỉnh tắt); Gateway từ chối ghi (`E_OWNER_CONFLICT`).
- Override trỏ tới cụm không còn (căn lại sau khi đổi lời) → giữ trong file, `graph.status` có mục `{key: 'caption_override:<id>', type: 'caption_override', status: 'orphan'}`; bảng hiển thị cảnh báo.

## Requirements *(mandatory)*

- **FR-001** Áp override theo thứ tự: `splits` → `merges` → `groups[id]` (mốc, chữ). Tách tại `at_word` dùng mốc từ trong `audio_meta` (không có → chia theo tỉ lệ số từ); chia `emphasis`. Gộp: cụm kề, cùng line; mốc min/max; chữ ghép từ.
- **FR-002** `captions.load` / `captions.save` (IPC, D10 mục 4); `captions.save` ghi qua Gateway với phiên `main` của UI.
- **FR-003** `.sf/preview/voice.wav` (PCM 16-bit mono 48 kHz) + `waveform.json {source_hash, step_ms: 10, duration_ms, peaks}` — dẫn xuất.
- **FR-004** `index` dùng cụm sau override: chữ sửa tay → một khối; còn lại tô từng từ, mốc từ kẹp trong cụm.
- **FR-005** `graph.status` báo override `orphan`.
- **FR-006** Sự kiện `artifact.changed {channel, path, hash}` cho video đang mở; bảng tải lại khi `caption_groups`/`caption-overrides`/`audio_meta` đổi (nếu không có chỉnh chưa lưu).
- **FR-007** Renderer phát `voice.wav` qua giao thức `sf-media:` của `main` — chỉ đọc, chỉ file `.sf/preview/*.wav`, hỗ trợ Range.

## Success Criteria *(mandatory)*

- **SC-001 (AC-M3-03)** Kéo mép đầu một cụm +50 ms trong bảng → lưu → build `index` → `captions.html` có `data-start` của cụm tăng đúng 0,05 s; chữ sửa tay xuất hiện.
- **SC-002** Lưu với `base_hash` cũ → `E_BASE_HASH_MISMATCH`; chồng cụm / ra ngoài line → `E_SCHEMA_INVALID`.
- **SC-003** Tách rồi gộp lại cho cụm đúng như ban đầu (chữ, `word_range`, mốc); `owner = studio` → chỉ đọc + Gateway chặn.
- **SC-004** Override trỏ cụm không còn → `orphan` trong `graph.status`.
- **SC-005** UI: bảng hiện dưới Xem trước, audio phát được (thời lượng đúng), sửa chữ → tự lưu vào `caption-overrides.json`.
