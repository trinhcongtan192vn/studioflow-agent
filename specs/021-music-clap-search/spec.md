# Feature Specification: Tìm nhạc bằng mô tả (CLAP)

**Feature Branch**: `021-music-clap-search`

**Created**: 2026-10-04

**Status**: Draft

**Input**: Backlog dòng 021: "music-clap-search".

**Phủ yêu cầu**: FR-MU-04, AC-M2-04.

**Dựa trên `docs/`**: D8 mục 1 (`.index/<track_id>.npy`, `MusicTrack.embedding`), 2.2 (`music.find`, `MusicFindInput.query`) · D4 mục 4.3 (`audio.clap`, engine `clap`, capability nội bộ `music.embed`), 9.3 (worker Python), 10 (models.yaml, hồ sơ `full`) · FN-012/021 (điểm = 0,6 × cosine + 0,25 × từ khóa + 0,15 × (1 − phạt dùng gần đây)) · Spike S11 (chạy trong tính năng này).

## User Scenarios & Testing *(mandatory)*

### US1 — Embedding khi nạp (P1)
1. `music.library.add`: sau phân tích, khi provider `audio.clap` khả dụng → embedding âm thanh (3 cửa sổ 10 s ở 25/50/75 % độ dài, trung bình, chuẩn hóa) ghi `music/.index/<mt>.npy` (float32) của kho; `track.embedding = {model, vector_file}`. Cache theo hash file.
2. CLAP chưa cài → bỏ qua embedding, không lỗi (tìm theo từ khóa như 012).
3. `sf music reindex [--scope]` tạo embedding cho bài chưa có.

### US2 — Tìm bằng mô tả (P1) — AC-M2-04
1. `music.find {query}`: có CLAP + có bài có embedding → embedding văn bản của `query`; điểm = 0,6 × max(0, cosine) + 0,25 × khớp từ khóa + 0,15 × (1 − phạt dùng gần đây); lý do có "khớp mô tả 0.xx". Lọc cứng (tags/BPM/energy/thời lượng/loại trừ) giữ nguyên.
2. Model CLAP hiểu tiếng Anh: mô tả tool hướng dẫn agent viết phần mô tả bằng tiếng Anh (ví dụ người dùng nói "căng thẳng, chậm, piano" → `query: "tense, slow, piano"`).
3. Không có CLAP/embedding → công thức 012.

### Edge Cases
- File không đọc được khi embedding → bài vẫn được thêm (không embedding), ghi lý do trong log.
- Vector khác số chiều/model khác model hiện tại → bỏ qua bài đó trong phần cosine.

## Requirements *(mandatory)*
- **FR-001**: Engine Python `clap` (`laion/clap-htsat-unfused`, transformers 4.57.1, torch 2.8 CPU) — task `music.embed`, `text.embed`; `models.yaml` `clap-model`, `clap-env` (hồ sơ `full`).
- **FR-002**: Provider `audio.clap` (`music.embed`) + `embedTexts`.
- **FR-003**: Embedding khi nạp + `sf music reindex`.
- **FR-004**: `music.find`/`sfx.find` xếp hạng theo FN-021 khi có CLAP.
- **FR-005**: Installer ghi `refs/main` đúng định dạng Hugging Face (không xuống dòng).

## Success Criteria
- **SC-001**: Trên 3 clip tổng hợp (piano, trống, nhiễu) với CLAP thật: "solo piano melody" → piano đứng đầu; "drum beat" → trống đứng đầu; "tense slow piano" → piano đứng đầu.
- **SC-002**: Unit: thứ tự kết quả theo công thức FN-021 với embedding giả.
- **SC-003** (Tan, thủ công): AC-M2-04 trên kho 50 bài thật — "căng thẳng, chậm, piano" có bài phù hợp trong top 3.

## Ngoài phạm vi
Tìm SFX theo âm thanh mẫu, gợi ý tag bằng agent, màn kho nhạc (UI), `loop_points`.
