# Research — 012

## R1. Phân tích
- librosa `beat_track` trên onset strength (22,05 kHz); độ tin cậy = tự tương quan onset tại độ trễ của nhịp (0–1) `[chờ S11]`. BPM có thể lệch bội 2 → lọc `bpm` của `music.find` chấp nhận ×2 / ÷2 (S11: "cho phép nhân/chia đôi").
- Energy = RMS → dBFS ánh xạ −60..0 dB → 0..1; đường energy mỗi giây; LUFS bằng pyloudnorm (BS.1770), bài quá ngắn → −70; im lặng đầu/cuối theo khung 50 ms dưới −50 dBFS. `loop_points` chưa tính (`[chờ S11]`) → bài ngắn hơn đoạn được lặp nguyên bài.
- Thư viện chạy CPU → provider thật cả khi `SF_GPU=0`; test dùng venv `workers/gpu` (nhóm `audio`), app dùng `<app-data>/providers/python/audio-analysis`.
- Worker Python chạy với `cwd` = thư mục mã worker: cwd của tiến trình gọi (ví dụ `packages/core` có `coverage/`) bị numba import nhầm.

## R2. Ducking
- **Decision**: thay `sidechaincompress` (FN-012 gợi ý) bằng đường bao `volume` tất định từ khoảng giọng (gộp khoảng cách < 800 ms; attack 50 ms trước giọng, release 400 ms sau giọng; mức đúng `music.duck_db`). Lý do: mức giảm chính xác theo cấu hình, tái lập, không phụ thuộc độ to tương đối nhạc/giọng; test đo được (SC-002: chênh ≥ 6 dB, thực tế ≈ 12 dB).
- Bed một file `public/music/bed-<hash>.wav` (48 kHz stereo) cho cả video; đầu vào đổi → tên mới. Phần tử `<audio id="el-music">` mang thuộc tính D8 mục 3 (`data-sf-track` liệt kê bài).

## R3. Xếp hạng
- 0,7 × tỉ lệ từ khóa khớp tags/title/description/tên gốc + 0,3 × (1 − phạt), phạt = số video trong 5 video gần nhất đã dùng bài / 2 (tối đa 1); bằng điểm → kho kênh trước.
