# Feature Specification: Kho nhạc cơ bản — nạp, phân tích, tìm, ducking, CREDITS

**Feature Branch**: `012-music-library-basic`

**Created**: 2026-10-04

**Status**: Draft

**Input**: Backlog dòng 012: "nạp, phân tích, tìm theo BPM/tag, ducking, CREDITS".

**Phủ yêu cầu**: FR-MU-01, FR-MU-02, FR-MU-03, FR-MU-05, FR-MU-06, AC-M1-04.

**Dựa trên `docs/`**: D8 (toàn bộ) · D4 mục 2.4 (`music.library.add`, `music.find`, `sfx.find`), 4.3 (provider `audio.analysis`, engine `audio-analysis`), 7 (cache), 8.1 (nút `index` có nhạc), 9.3 (worker Python) · D3 mục 1 (kho `music/`), 4 (`Scene.music`, `Frame.sfx`), 7.2 (`music.volume_db`, `music.duck_db`) · FN-012/021 (gợi ý xếp hạng, trộn, CREDITS).

## User Scenarios & Testing *(mandatory)*

### US1 — Nạp và phân tích (P1) — FR-MU-01/02
1. `music.library.add {files (uploads/…), scope: channel|app, kind?, source?, url?, attribution?, tags?, description?}` (job) → mỗi file lưu `music/files/<mt>.<ext>` của kho, `manifest.json` (D8 `MusicManifest`) có `analysis` (thời lượng, sample rate, kênh, BPM + độ tin cậy khi ≥ 5 s, energy + đường energy mỗi giây, LUFS, im lặng đầu/cuối).
2. Trùng `hash` trong kho → trả `track_id` có sẵn. File không đọc được → `skipped {file, reason}` (`E_AUDIO_UNSUPPORTED`).
3. `kind` mặc định: `sfx` nếu < 10 s, ngược lại `music`; tag chữ thường.

### US2 — Tìm nhạc (P1) — FR-MU-03, AC-M1-04
1. `music.find {query?, tags?, bpm?, energy?, min_duration_ms?, exclude_ids?, limit?}`: lọc cứng theo tags/BPM/energy/thời lượng/loại trừ; xếp hạng 0,7 × khớp từ khóa + 0,3 × (1 − phạt dùng gần đây); kênh ưu tiên khi bằng điểm; `reasons` ngắn ("BPM 88", "tag: piano").
2. `sfx.find` cùng giao diện, chỉ `kind = sfx`, bỏ `min_duration_ms`.
3. Không có kết quả → `E_MUSIC_NOT_FOUND` kèm gợi ý nới điều kiện.
4. AC-M1-04: nạp 10 bài → "nhạc chậm, ~90 BPM, dài ≥ 3 phút" trả đúng bài.

### US3 — Nhạc trong video, ducking (P1) — FR-MU-05
1. Scene có `music.track_id` → bài chép vào `public/music/<mt>.<ext>`; nút `index` lắp một bed nhạc `public/music/bed-<hash>.wav` bằng FFmpeg: các đoạn theo scene (scene liền nhau cùng bài nối liền; đổi bài crossfade 1 000 ms; fade in/out 1 000 ms đầu/cuối; bài ngắn hơn đoạn → lặp), chuẩn hóa −24 LUFS, mức `music.volume_db`, ducking `sidechaincompress` theo giọng (attack 50 ms, release 400 ms, mức `music.duck_db`).
2. `index.html` có `<audio>` nhạc với `data-sf-track`, `data-volume-db`, `data-fade-in-ms`, `data-fade-out-ms`, `data-duck-db` (D8 mục 3).

### US4 — CREDITS (P2) — FR-MU-06
`buildCredits(tracks, assets)` theo định dạng FN-012/021; không có mục có `attribution` → không có nội dung (013 ghi `CREDITS.txt` khi render phát hành).

### Edge Cases
- Kho app ghi nội bộ (`<app-data>/music/`), kho kênh qua module ghi.
- `used_in` cập nhật khi index dùng bài.

## Requirements *(mandatory)*
- **FR-001**: Engine Python `audio-analysis` (librosa, pyloudnorm, soundfile — ghim) + provider `audio.analysis` (capability nội bộ `music.analyze`); `scripts/setup-engine.mjs audio-analysis`.
- **FR-002**: Kho nhạc app/kênh, `music.library.add` (job), dedupe hash, kind mặc định.
- **FR-003**: `music.find`, `sfx.find` (lọc cứng, xếp hạng FN-012, `E_MUSIC_NOT_FOUND`).
- **FR-004**: Bed nhạc + ducking + chuẩn hóa bằng FFmpeg trong nút `index`; thuộc tính D8 mục 3.
- **FR-005**: `buildCredits`.
- **FR-006**: CLI `sf music add|find`.
- **FR-007**: Hợp đồng `MusicManifest`/`MusicTrack`/`MusicFindInput`/`MusicFindOutput` sinh từ D8 vào `docs/contracts/music/d8.ts` (+ JSON Schema `MusicManifest`).

## Success Criteria
- **SC-001**: AC-M1-04 với 10 bài tổng hợp có BPM/thời lượng/tag khác nhau (test tích hợp, phân tích thật).
- **SC-002**: Bed nhạc: mức nhạc dưới giọng thấp hơn mức nhạc khi im lặng ≥ 6 dB (đo bằng FFmpeg `astats`).

## Ngoài phạm vi
CLAP/tìm bằng mô tả tự nhiên (021), `loop_points` (`[chờ S11]` — lặp cả bài), màn kho nhạc (UI), SFX trong index (M2), gợi ý tag bằng agent.
