# FN-030 — Workflow `shorts`

> **Ghi chú tính năng — không ràng buộc.** Đầu vào gợi ý cho `/specify` và `/plan` của tính năng 030. Ràng buộc nằm ở spec hệ thống (D3–D13) và constitution; khi tính năng được đặc tả, `specs/030-*/spec.md` thay thế file này.

**Phiên bản:** 1.0 · **Giai đoạn:** M4 · **Phủ:** FR-WF-07, AC-M4-01 · **Tính năng:** 030
**Fork từ:** HyperFrames `motion-graphics` + `faceless-explainer` · **Quy tắc chung:** `workflows-common.md` (FN-common)

## 1. Mục đích
Video dọc ≤ 60 giây, độc lập hoặc cắt từ một video dài của kênh. Cấu trúc **Hook → Insight → Paradox**.

## 2. Hai chế độ
- **Mới:** brief → kịch bản 3 beat (Hook ≤ 5 giây, Insight, Paradox/kết) → như `narrated-explainer` với output `yt-shorts-1080x1920`.
- **Từ video dài:** pha briefing chọn video nguồn (`BRIEF.md.source_video_id`) + các beat; engine thêm video nguồn vào `state.json.read_only_videos` (đọc qua `artifact.read` tiền tố `video:<vd>/`, D4 mục 2.2); line giữ nguyên chữ được chép sang `SCRIPT.md` mới với ID mới, audio lấy lại từ cache (cùng khóa); viết lại hook; dựng lại frame theo bố cục dọc.

## 3. Khác biệt

| Step id | Khác biệt |
|---|---|
| `script` | Rubric `script-shorts`; mục tiêu ≤ 55 giây; `audio_duration` sau `voice` đo trên audio thật (không giới hạn số từ) |
| `storyboard` | Frame 2–5 giây; chữ lớn trong vùng an toàn dọc; blueprint `big-text`, `stat-pop`, `split-reveal` |
| `captions` | Karaoke từng từ, cỡ lớn, giữa màn hình |
| `music` | Bắt nhịp: cắt frame theo phách nếu có BPM |
| `meta` | `params: { title_max: 60 }`; kèm `#shorts` |

## 4. Gate thêm
Tổng thời lượng ≤ `max_duration_ms` của output profile (60 000 ms); mọi chữ nằm trong `safe_area`.

## 5. Nghiệm thu
AC-M4-01; `samples/shorts-30s/`.
