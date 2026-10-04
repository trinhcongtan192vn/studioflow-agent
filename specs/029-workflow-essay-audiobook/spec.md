# Feature Specification: Workflow `essay-audiobook`

**Feature Branch**: `029-workflow-essay-audiobook`

**Created**: 2026-10-04

**Status**: Draft

**Input**: Backlog dòng 029: "`workflow-essay-audiobook`".

**Phủ yêu cầu**: FR-WF-07 (phần essay-audiobook).

**Dựa trên `docs/`**: D6 mục 1–2 (manifest, thư viện bước; thêm `config_defaults`), D3 mục 7.1–7.2 (tầng cấu hình `workflow`; khóa `voice.pause_after_ms`), FN-029, FN-common.

## User Scenarios & Testing *(mandatory)*

### US1 — Tiểu luận/sách nói từ brief tới MP4 (P1)
Chọn workflow `essay-audiobook`: câu hỏi brief thêm tác phẩm/tác giả gốc và trích dẫn; kịch bản refine theo rubric `script-essay` (chiều sâu, mạch ý, trung thực trích dẫn, nhịp đọc chậm; beat 1–3 phút = chương); storyboard tối giản (frame 15–30 s, frame tiêu đề chương, trích dẫn nổi bật, pan chậm); ảnh sinh tối đa một mỗi chương; caption tĩnh cụm ≤ 10 từ; nhạc nền −21 dB; khoảng lặng 600 ms sau mỗi line; meta có chương theo beat.

### US2 — Tầng cấu hình workflow (P1)
`workflow.yaml.config_defaults` là tầng cấu hình `workflow` giữa kênh và video (Tan chọn, research R1): workflow ghi đè kênh, video vẫn ghi đè workflow. Chỉ khóa cho phép ở tầng kênh hoặc video; sai khóa/tầng/kiểu → gói không tương thích.

## Requirements *(mandatory)*

- **FR-001** D6: `WorkflowManifest.config_defaults`; D3 7.1: tầng `workflow`; `resolveConfig` trả `source: 'workflow'`.
- **FR-002** Khóa mới `voice.pause_after_ms` (Ms, channel/video, mặc định 0): line không khai báo `pause_after_ms` nhận giá trị này (timeline, gate `audio_duration`).
- **FR-003** `caption.style`: `caption-highlight` (mặc định), `caption-static` (không tô từng từ), `caption-pill-karaoke` (030).
- **FR-004** Chương của meta lấy mốc line đầu beat trên timeline khi đã có `frame_timing`.
- **FR-005** Gói `extensions/workflows/essay-audiobook/` (manifest, rubric `script-essay`, skill, plugin).

## Success Criteria *(mandatory)*

- **SC-001** E2E (TTS/ASR/text/agent giả, HyperFrames + FFmpeg thật): duyệt brief → script → storyboard → finalize, render phát hành; `caption.max_words` = 10 nguồn `workflow` (kênh đặt 6); cụm > 6 và ≤ 10 từ; caption tĩnh; timeline = Σ(audio + 600 ms); chương thứ hai = mốc line đầu beat 2.
- **SC-002** Unit: kiểm `config_defaults`; khoảng lặng mặc định; ba kiểu caption.
