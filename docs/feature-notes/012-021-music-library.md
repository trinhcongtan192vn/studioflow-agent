# FN-012 / FN-021 — Kho nhạc: phân tích, xếp hạng, trộn, ghi công

> **Ghi chú tính năng — không ràng buộc.** Đầu vào gợi ý cho `/specify` và `/plan` của tính năng 012 (`music-library-basic`) và 021 (`music-clap-search`). Hợp đồng ràng buộc ở D8; khi tính năng được đặc tả, `specs/012-*/spec.md` và `specs/021-*/spec.md` thay thế file này.

**Spike:** S11 · **Phủ:** FR-MU-01..06, AC-M1-04, AC-M2-04

## 1. Phân tích khi nạp (012)
- Thời lượng, BPM + độ tin cậy, RMS và đường energy (mỗi 1 giây), LUFS, im lặng đầu/cuối, điểm lặp (tự tương quan chroma) `[chờ S11]`.
- `kind` mặc định: `sfx` nếu < 10 giây, ngược lại `music`.
- Agent gợi ý tag/mô tả từ tên file, tiêu đề, `source`; người dùng xác nhận trong chat hoặc màn kho nhạc.

## 2. Xếp hạng
- **012 (từ khóa):** điểm = 0,7 × khớp từ khóa `query` với tags/title/description + 0,3 × phạt dùng gần đây (bài trong `used_in` của 5 video gần nhất của kênh bị trừ).
- **021 (CLAP):** điểm = 0,6 × cosine(embedding text của `query`, embedding bài) + 0,25 × từ khóa + 0,15 × phạt dùng gần đây. Model CLAP chọn ở S11.
- Bài có `loop_points` được tính thời lượng lặp tối đa ×3 khi lọc `min_duration_ms`.
- `reasons` ví dụ: "BPM 88", "tag: piano, buồn".

## 3. Đặt vào video
- Agent đọc `sf-scene.music.query`, gọi `music.find`, chọn bài, ghi `track_id`.
- Scene liền nhau cùng bài → một đoạn liên tục; đổi bài → crossfade 1 000 ms; fade in/out 1 000 ms đầu/cuối video.
- Bài ngắn hơn đoạn cần → lặp theo `loop_points`; không có → fade out cuối bài và cảnh báo trong `graph.status`.

## 4. Ducking và chuẩn hóa
- Mặc định qua `media-use --local-only` `[chờ S11]`; dự phòng FFmpeg `sidechaincompress` (giọng làm sidechain), attack 50 ms, release 400 ms, mức `music.duck_db`.
- Nhạc nền chuẩn hóa về −24 LUFS trước khi trộn; bản cuối `loudnorm` hai lượt về `loudness_lufs` của profile.

## 5. Định dạng `CREDITS.txt`

```
Music:
"<title>" — <artist>
<attribution nguyên văn>
<url>

Images:
<attribution nguyên văn của asset>
```
