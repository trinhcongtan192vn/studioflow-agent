# FN-029 — Workflow `essay-audiobook`

> **Ghi chú tính năng — không ràng buộc.** Đầu vào gợi ý cho `/specify` và `/plan` của tính năng 029. Ràng buộc nằm ở spec hệ thống (D3–D13) và constitution; khi tính năng được đặc tả, `specs/029-*/spec.md` thay thế file này.

**Phiên bản:** 1.0 · **Giai đoạn:** M4 · **Phủ:** FR-WF-07 · **Tính năng:** 029
**Fork từ:** HyperFrames `faceless-explainer` · **Quy tắc chung:** `workflows-common.md` (FN-common)

## 1. Mục đích
Tiểu luận/sách nói 10–40 phút về tâm lý, triết học, tóm tắt sách: nhịp chậm, hình tối giản, trích dẫn nổi bật.

## 2. Khác biệt so với `narrated-explainer`

| Step id | Khác biệt |
|---|---|
| (pha briefing) | `brief.questions` thêm: tác phẩm/tác giả gốc, các trích dẫn cần có |
| `script` | Rubric `script-essay` (tiêu chí `depth`, `flow` thay `hook` trọng số thấp hơn); beat dài 1–3 phút; `pause_after_ms` mặc định 600 |
| `storyboard` | 1 frame cho 15–30 giây; blueprint `quote`, `chapter-title`, `slow-pan`, `abstract-loop` |
| `assets` | Ưu tiên `library` và `code`; ảnh sinh tối đa 1 cho mỗi chương |
| `captions` | Cụm tối đa 10 từ; kiểu caption tĩnh, không karaoke |
| `meta` | Có chương (`chapters`) theo beat |

## 3. Tham số
Nhịp đọc chậm, nhiều khoảng lặng là chỉ dẫn văn phong trong prompt `script-essay`, không đặt số từ/phút; thời lượng kiểm trên audio thật (`audio_duration`). `music.volume_db` −21.

## 4. Nghiệm thu
`samples/essay-60s/`; video 20 phút render không lỗi, chương khớp mốc thời gian beat.
