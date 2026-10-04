# Feature Specification: Workflow `shorts`

**Feature Branch**: `030-workflow-shorts`

**Created**: 2026-10-05

**Status**: Draft

**Input**: Backlog dòng 030: "`workflow-shorts`".

**Phủ yêu cầu**: FR-WF-07 (phần shorts), AC-M4-01.

**Dựa trên `docs/`**: D6 mục 1–2, 4.2 (gate khách quan), D3 mục 4 (`OutputProfile.max_duration_ms`, `safe_area`), 5.2 (`BRIEF.source_video_id`), 5.10 (`read_only_videos`), 7.2 (`meta.hashtags` mới), D4 mục 2.2 (`video:<vd>/…`), FN-030, FN-common.

## User Scenarios & Testing *(mandatory)*

### US1 — Shorts cắt từ video dài (P1) — AC-M4-01
Brief có `source_video_id` (+ beat dùng trong văn xuôi brief) → khi bắt đầu workflow, engine thêm video nguồn vào `state.read_only_videos` (agent đọc `video:<vd>/…`). Bước script đưa kịch bản nguồn vào prompt: giữ nguyên văn các line dùng lại (audio lấy lại từ cache TTS cùng khóa), viết mới hook/kết; ID mới. Storyboard dựng lại bố cục dọc. Output `yt-shorts-1080x1920` (1080×1920, ≤ 60 s, vùng an toàn lệch: chừa lề phải và 20% dưới).

### US2 — Shorts viết mới (P1)
Như narrated-explainer với rubric `script-shorts` (Hook → Insight → Paradox), frame 2–5 s, chữ lớn ở nửa trên, caption karaoke lớn giữa màn hình, meta tiêu đề ≤ 60 ký tự + `#shorts`.

### US3 — Gate thêm (P1)
`max_duration` (voice: audio thật; finalize: timeline) ≤ `max_duration_ms` của profile; `text_safe_area` (finalize): mọi chữ đang hiện ở giữa mỗi frame nằm trong `safe_area` (đo trong Chrome headless trên trang xem trước composition của HyperFrames).

## Requirements *(mandatory)*

- **FR-001** Profile `extensions/outputs/yt-shorts-1080x1920/output.json`.
- **FR-002** Objective `max_duration` (`params.source: audio|timeline`), `text_safe_area`.
- **FR-003** Engine: `source_video_id` → `read_only_videos`; Gateway đọc `read_only_videos` từ `state.json` lúc gọi (phiên `main` mở trước khi bắt đầu workflow).
- **FR-004** Script: kịch bản nguồn (bỏ ID) trong prompt khi có `source_video_id`.
- **FR-005** Packet: vùng an toàn lệch nêu theo px; caption karaoke → dải giữa màn hình để trống.
- **FR-006** Khóa `meta.hashtags` (D3 7.2): thêm cuối mô tả.
- **FR-007** Gói `extensions/workflows/shorts/` (`config_defaults`: caption karaoke ≤ 3 từ, `meta.title_max` 60, `meta.hashtags` `#shorts`, `frame.min_duration_ms` 2000).

## Success Criteria *(mandatory)*

- **SC-001 (AC-M4-01)** E2E: short cắt từ video dài → MP4 1080×1920 ≤ 60 s; đọc được video nguồn; 2 line dùng lại từ cache, 2 line mới sinh; gate thời lượng + vùng an toàn qua; caption karaoke; `#shorts`; chữ dời ra lề phải → `text_safe_area` báo `right`.
