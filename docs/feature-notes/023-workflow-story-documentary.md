# FN-023 — Workflow `story-documentary`

> **Ghi chú tính năng — không ràng buộc.** Đầu vào gợi ý cho `/specify` và `/plan` của tính năng 023. Ràng buộc nằm ở spec hệ thống (D3–D13) và constitution; khi tính năng được đặc tả, `specs/023-*/spec.md` thay thế file này.

**Phiên bản:** 1.0 · **Giai đoạn:** M2 · **Phủ:** FR-WF-06, FR-SC-07, FR-IM-02/03, AC-M2-01..03 · **Tính năng:** 023
**Fork từ:** HyperFrames `faceless-explainer` + `general-video` · **Quy tắc chung:** `workflows-common.md` (FN-common)

## 1. Mục đích
Kể chuyện tài liệu 8–20 phút (lịch sử, nhân vật, sự kiện): nhiều scene theo không gian/thời gian, bản đồ, dòng thời gian, ảnh minh họa sinh bằng Qwen-Image-2.1 theo look kênh.

## 2. Bước
Như `narrated-explainer` với khác biệt:

| Step id | Khác biệt |
|---|---|
| (pha briefing) | `brief.questions` thêm: mốc thời gian, địa danh chính, nhân vật chính, nguồn tham khảo |
| `script` | Rubric `script-documentary` (thêm tiêu chí `accuracy` trọng số 0,3); 6–12 beat |
| `storyboard` | **refine bật** (producer: phiên `producer`; critic: model ngoài); mỗi scene có `setting`, `time_of_day`, `mood`, `look` |
| `assets` | `generate` mặc định cho ảnh nền và minh họa; ảnh nhân vật lịch sử dùng `reference_asset_ids` để giữ nhất quán; vật thể tách nền (`transparent: true`) cho dựng lớp |
| `look`, `effects`, `overlays` | Như `narrated-explainer` (từ M3; ở M2 dùng look kênh cố định) |
| `music` | Nhạc theo scene |

## 3. Delta so với upstream
Delta chung + : scene là đơn vị bắt buộc; blueprint bổ sung `timeline`, `map-route`, `portrait-caption`, `archive-photo` (D13); ghép phần dựng cảnh của `general-video` cho scene có nhiều lớp.

## 4. Tham số mặc định
- Ảnh: 1664×928 (16:9) cho nền, 1024² RGBA cho vật thể; `steps` 15; seed cố định theo scene để nhất quán `[chờ S2]`.
- Mật độ: 1 ảnh sinh cho mỗi 15–25 giây; phần còn lại dùng lại ảnh với chuyển động hoặc đồ họa code.

## 5. Nghiệm thu
- `samples/doc-60s/` chạy hồi quy (ảnh sinh được ghi sẵn để chạy không cần GPU; một biến thể `gpu` chạy thật).
- AC-M2-01..03.
