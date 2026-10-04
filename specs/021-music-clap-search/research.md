# Research — 021

## R1. Chọn model CLAP (spike S11, 2026-10-04)
- `laion/larger_clap_music` (khuyến nghị cho nhạc) trên Hugging Face cho **embedding văn bản suy biến**: cosine giữa các câu bất kỳ ≈ 0,999, `logit_scale` ≈ 0 (model đã huấn luyện ≈ 2,66), độ tương đồng văn bản–âm thanh ≈ 0,01 với mọi cặp — cả transformers 5.18 lẫn 4.57.1, nạp không thiếu khóa nào → lỗi nằm ở bản checkpoint. Loại.
- `laion/clap-htsat-unfused` (Apache-2.0, 1,3 triệu lượt tải): `logit_scale` 2,93/2,66; clip tổng hợp: "solo piano melody" → piano 0,35 (trống −0,05, nhiễu −0,04); "drum beat" → trống 0,29; "white noise" → nhiễu 0,46; "tense slow piano" → piano 0,35. **Chọn.** Model âm thanh tổng quát (không riêng nhạc) — đánh giá trên kho nhạc thật (AC-M2-04, 50 bài) để Tan chấm.
- Tốc độ CPU: nạp 1,8 s; 0,4 s/bài (3 cửa sổ 10 s).
- transformers 4.57.1 (dòng 4.x; 5.x đổi API processor `audios` → `audio`, engine thử cả hai).

## R2. Định dạng cache Hugging Face
- huggingface_hub 0.36 (theo transformers 4.57) đọc `refs/main` nguyên văn → dấu xuống dòng làm sai đường dẫn snapshot ("couldn't find them in the cached files"). Installer ghi đúng định dạng HF (không xuống dòng); file cũ đã sửa.

## R3. Tiếng Việt
- CLAP chỉ hiểu tiếng Anh. Agent dịch mô tả khi gọi `music.find` (hướng dẫn trong mô tả tool); phần từ khóa vẫn khớp tag tiếng Việt (0,25).

## R4. Vector
- `.npy` float32 1 chiều (512), đọc trong core bằng bộ đọc NPY tối giản (header + Float32Array, little-endian). Vector đã chuẩn hóa → cosine = tích vô hướng.
