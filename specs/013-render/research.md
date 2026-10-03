# Research — 013

## R1. Render bằng CLI HyperFrames
- `hyperframes render . -o <tmp>/raw.mp4 --fps <profile.fps> --crf <profile.video.crf>` trong thư mục video; tiến độ đọc từ dòng `NN%  <pha>` (capture → encode → assemble). Đo (2026-10-04, máy tham chiếu): video mẫu 6,5 s 1080p30 render ~16–20 s gồm ~5 s khởi động Chrome; 6 worker; `hardware gpu`. Số liệu 3/10 phút của S5 đo khi có video thật ở 016.
- **Trả lời S3 (a)(b)(f)**: index do app lắp (frame sub-composition, giọng từ `audio/lines`, caption) render đến MP4 có AAC; `data-sf-id` không đổi sau render (render chỉ đọc).
- Hủy: `taskkill /T /F` cả cây (HyperFrames mở nhiều Chrome) — dừng < 5 s trong test, `render.json` `canceled`.

## R2. Hậu kỳ
- Độ to bản cuối = `loudness_lufs` của profile bằng `loudnorm` hai lượt (đo rồi áp `linear=true`); phát hành giữ nguyên luồng video (`-c:v copy`), nháp mã lại kèm `drawtext` "NHÁP" (font Arial của Windows qua `fontfile`, tránh fontconfig).

## R3. Gate phát hành (D4 chỉ ghi "chạy gate trước nếu release")
- **Decision**: `graph_fresh` (sau build mọi nút fresh), `asr` (không còn line `mismatch`), `approvals` (video trong workflow: mọi điểm duyệt khác bước render đã `approved`), `hf_check` (`hyperframes check` không lỗi). Nháp chạy cùng gate nhưng chỉ ghi `gate_results` (cảnh báo). `duration` theo `max_duration_ms` của profile để 030 (Shorts) — profile M1 không đặt.

## R4. Khôi phục (AC-M1-05)
- Job `render` không idempotent: khi mở lại `queue.recover()` đánh `E_JOB_INTERRUPTED` và gọi `onInterrupted` → `render.json` `running` → `failed` (ghi `gate_results` "interrupted"). `render_id` cấp ở tool để biết thư mục. Render lại = job mới, `rd` mới.
