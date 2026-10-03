# FN-common — Quy tắc chung cho các workflow

> **Ghi chú tính năng — không ràng buộc.** Đầu vào gợi ý cho `/specify` và `/plan` của tính năng workflow. Ràng buộc nằm ở spec hệ thống (D3–D13) và constitution; khi tính năng được đặc tả, `specs/workflow-*/spec.md` thay thế file này.

**Phiên bản:** 1.0 · **Ngày:** 03/10/2026 · **Dựa trên:** `00-architecture.md` mục 8.4–9, D6
**Phủ:** FR-CP-02..05, FR-IM-01, FR-MU-05

Áp dụng cho mọi ghi chú workflow trong `feature-notes/` trừ khi file workflow ghi khác.

## 1. Mật độ frame và thời lượng
- Thời lượng frame suy từ audio các line của nó (D4 mục 8). Frame không có line dùng `frame.min_duration_ms` (mặc định 2000 ms). Mỗi line thuộc đúng một frame; mô hình thời gian ở D4 mục 8.3.
- Mặc định 1 frame cho 6–12 giây lời đọc; frame > 15 giây PHẢI có chuyển động bên trong (keyframe, Ken Burns, lộ dần lớp).
- Frame mở đầu (hook) ≤ 8 giây.

## 2. Asset (bước `assets`)
Thứ tự nguồn cho mỗi `asset_request`: `library` (tìm trong thư viện kênh theo tag/mô tả) → `code` (SVG/HTML, biểu đồ, chữ, hình khối) → `generate` (`image.generate`, chỉ khi capability khả dụng) → `user` (hỏi người dùng nạp). Asset sinh/nạp được thêm vào thư viện kênh kèm tag và mô tả.

## 3. Caption (bước `captions`)
- Chữ từ `SCRIPT.md` (`text`, không dùng `tts_text`); mốc từ `asr.align`.
- Cụm tối đa `caption.max_words` từ (mặc định 7), không vắt qua hai line, ngắt ưu tiên ở dấu câu.
- Nhấn mạnh (`emphasis`): tên riêng, số, từ khóa trong `BRIEF.md`.
- Thành phần mặc định `caption.style` của kênh; phim ngắn dùng màu theo `caption_color` của người nói.
- Vị trí trong vùng an toàn của output profile.

## 4. Transition
Mặc định crossfade 400–600 ms giữa frame cùng scene; transition mạnh hơn (theo catalog HyperFrames) giữa scene. Mỗi video dùng tối đa 3 loại transition.

## 5. Nhạc
- Mỗi scene có nhạc theo `sf-scene.music` hoặc `music: none`; nhạc nền ở `music.volume_db` (mặc định −18 dB); scene liền nhau cùng bài thì nối liền, không cắt lại.
- Ducking `music.duck_db` (mặc định −12 dB) dưới giọng; fade in/out 1 000 ms đầu/cuối video và khi đổi bài.
- Độ to tổng sau render đạt `loudness_lufs` của output profile (±1 LU).

## 6. Look, hiệu ứng, overlay (từ M3)
- Look: `data-color-grading` theo `look.id` của kênh, biến thể theo `sf-scene.look`; chữ/hình HTML dùng bảng màu khớp look.
- Media effect: chạy `media-treatment --dry-run` trước, áp khi bước được duyệt; tối đa 2 hiệu ứng nặng mỗi phút video.
- Overlay: đề xuất theo `overlay.rules` của kênh (ví dụ lower third khi nhân vật/địa danh xuất hiện lần đầu); thẻ mô phỏng nền tảng thật chỉ dùng với nội dung có thật.

## 7. Thứ tự tầng
nền → nội dung → transition → overlay → caption; audio ở làn riêng.

## 8. Dự án mẫu
Mỗi workflow có `samples/<id>/` gồm `BRIEF.md` và đầu ra LLM ghi sẵn (D12) để chạy hồi quy 30–60 giây không cần gọi LLM thật.
