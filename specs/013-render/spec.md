# Feature Specification: Render nháp/phát hành theo output profile

**Feature Branch**: `013-render`

**Created**: 2026-10-04

**Status**: Draft

**Input**: Backlog dòng 013: "render nháp/phát hành, output profile".

**Phủ yêu cầu**: FR-RD-01, FR-RD-02, FR-RD-03 (+ FR-MU-06 ghi `CREDITS.txt`), AC-M1-05; trả lời S3 (a)(b)(f), một phần S5.

**Dựa trên `docs/`**: D4 mục 2.4 (`render.video` → job → `RenderRecord`), 3 (`RenderInput`), 4.3 (provider `render.hf-producer`), 5 (job, hủy), 6 (engine `render`), 8.1 (nút `render`, `credits`), 11 (đĩa) · D3 mục 1, 5.14 (`renders/<rd>/`, `render.json`), 5.15 (`publish.md` → `description.txt`) · D6 mục 2 (bước `render`, `finalize`) · D8 mục 3–4 (độ to bản cuối, CREDITS).

## User Scenarios & Testing *(mandatory)*

### US1 — Render nháp (P1) — FR-RD-01/02
1. `render.video {mode: 'draft'}` (job, engine `render`): build graph tới `index`, chạy gate (chỉ cảnh báo), render `index.html` bằng HyperFrames bản ghim (kích thước/fps/CRF theo output profile), chèn chữ "NHÁP", chuẩn hóa độ to về `loudness_lufs` của profile → `renders/<rd>/video.mp4` + `render.json` (`RenderRecord`).
2. Tiến độ job theo phần trăm của HyperFrames; hủy job dừng tiến trình render (cả Chrome con) ≤ 5 s, `render.json` `canceled`.

### US2 — Render phát hành (P1) — FR-RD-01, FR-RD-03
1. `mode: 'release'`: mọi gate phải qua, không thì job lỗi `E_GATE_FAILED` (`render.json` `failed` kèm `gate_results`).
2. Gate phát hành: `graph_fresh` (mọi nút fresh sau build), `hf_check` (`hyperframes check` không lỗi), `asr` (không line `mismatch`), `approvals` (video trong workflow: không còn điểm duyệt chờ/yêu cầu sửa của bước trước `render`), `duration` (≤ `max_duration_ms` của profile nếu có).
3. Kèm `CREDITS.txt` (nhạc/asset đã dùng có ghi công; không có → không tạo) và `description.txt` = thân `publish.md` (nếu có) + CREDITS.

### US3 — Khôi phục (P1) — AC-M1-05
Tắt app khi đang render → mở lại: job render `failed` (`E_JOB_INTERRUPTED`), `render.json` cập nhật `failed`, render lại được.

### US4 — Bước `render` của workflow (P2)
Executor bước `render` (D6) chạy như US1/US2 theo `params.mode`.

## Requirements *(mandatory)*
- **FR-001**: `render/hf-render.ts`: `hyperframes render <video> -o <tmp> --fps --crf --quiet`, đọc tiến độ, hủy bằng kill cây tiến trình.
- **FR-002**: `render/post.ts`: loudnorm hai lượt + (nháp) drawtext "NHÁP" bằng FFmpeg; `ffprobe` thời lượng.
- **FR-003**: `render/gates.ts`: gate phát hành (US2.2).
- **FR-004**: `render/render.ts`: điều phối, `render.json`, `CREDITS.txt`, `description.txt`; nhập file lớn vào project qua module ghi (`importFile`).
- **FR-005**: Tool `render.video`, job `render` (không idempotent → khôi phục thành `E_JOB_INTERRUPTED`), sửa `render.json` mồ côi khi mở core.
- **FR-006**: Executor bước `render`; CLI `sf render --channel --video [--mode draft|release]`.

## Success Criteria
- **SC-001**: Video mẫu (2 frame, giọng/caption giả) render nháp và phát hành ra MP4 1920×1080 30 fps có AAC 48 kHz, độ to −14 ± 1 LUFS; `data-sf-id` không đổi sau render.
- **SC-002**: Hủy giữa chừng dừng ≤ 5 s.

## Ngoài phạm vi
Render animatic (M2), Docker render, hàng đợi render nhiều video song song, dọn render nháp theo hạn mức (024).
