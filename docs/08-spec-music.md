# D8 — Spec nhạc và SFX

**Phiên bản:** 1.2 · **Ngày:** 03/10/2026
**Dựa trên:** `00-architecture.md` mục 7.3 · D3, D4 · **Spike:** S11
**Phủ:** FR-MU-01..06, AC-M1-04, AC-M2-04 · **Tính năng:** 012 `music-library-basic`, 021 `music-clap-search`

---

## 1. Kho nhạc

- Hai cấp: **app** (`<app-data>/music/`) dùng cho mọi kênh, **kênh** (`<channel>/music/`). Tìm kiếm gộp cả hai, kênh ưu tiên khi trùng điểm.
- Mỗi kho: `files/<track_id>.<ext>` (mp3, wav, flac, m4a, ogg) + `manifest.json` + `.index/<track_id>.npy` (embedding, từ M2).
- Giấy phép do người dùng tự quản lý ngoài app; app không kiểm hay chặn.

```ts
interface MusicManifest extends Versioned {   // schema_version 1
  tracks: MusicTrack[];
}

interface MusicTrack {
  id: MusicTrackId; kind: 'music' | 'sfx';
  file: RelPath; original_name: string; hash: Sha256;
  title?: string; artist?: string;
  source?: string; url?: string;             // ví dụ "YouTube Audio Library", "Pixabay"
  attribution?: string;                      // văn bản ghi công nguyên văn, nếu bài yêu cầu
  tags: string[];                            // thể loại, tâm trạng, nhạc cụ (chữ thường)
  description?: string;
  analysis: {
    duration_ms: Ms; sample_rate: number; channels: number;
    bpm?: number; bpm_confidence?: number;
    energy: number;                          // 0–1, RMS trung bình chuẩn hóa
    energy_curve: number[];                  // RMS mỗi 1 giây, 0–1
    loudness_lufs: number;
    loop_points?: { start_ms: Ms; end_ms: Ms }[];
    silence_head_ms: Ms; silence_tail_ms: Ms;
  };
  embedding?: { model: string; vector_file: RelPath };   // M2, '.index/<track_id>.npy' tương đối với thư mục kho
  added_at: Iso8601; used_in: VideoId[];
}
```

## 2. Hợp đồng tool

### 2.1 `music.library.add`
**Đầu vào:** `{ files: RelPath[] (trong uploads/ sau upload.ingest), scope: 'channel' | 'app', kind?: 'music'|'sfx', source?, url?, attribution?, tags?, description? }`
**Đầu ra (job):** `{ track_ids: MusicTrackId[], skipped: { file, reason }[] }`

Bất biến:
- Trùng `hash` trong kho → không thêm bản mới, trả `track_id` có sẵn.
- File lưu ở `files/<track_id>.<ext>`, giữ định dạng gốc.
- `analysis` luôn được điền trước khi bài dùng được để tìm; `embedding` có từ M2.
- Ghi `manifest.json` qua module ghi của Gateway (kho kênh như `artifact.write`; kho app là ghi nội bộ, D3 mục 8).

Nạp từ giao diện (084): app (host) đọc thẳng file/thư mục người dùng chọn trên ổ đĩa — không qua `uploads/`, giữ tên file làm `title`, thư mục con (tính từ thư mục chọn) thành `tags` nếu bật; một job cho cả lần nạp (tiến độ, hủy). Tool của agent vẫn chỉ nhận file trong `uploads/`.

### 2.2 `music.find` / `sfx.find`

```ts
interface MusicFindInput {
  query?: string;                       // mô tả tự nhiên hoặc từ khóa
  tags?: string[];                      // phải có tất cả
  bpm?: { min?: number; max?: number };
  energy?: { min?: number; max?: number };
  min_duration_ms?: Ms;
  exclude_ids?: MusicTrackId[];
  limit?: number;                       // mặc định 5
}
interface MusicFindOutput { results: { track_id: MusicTrackId; score: number; reasons: string[] }[] }
```

Bất biến:
- Tìm gộp kho app + kho kênh; kênh ưu tiên khi bằng điểm.
- Các điều kiện `tags`, `bpm`, `energy`, `min_duration_ms`, `exclude_ids` là **lọc cứng**; `query` chỉ dùng để xếp hạng.
- `score` trong khoảng 0–1, giảm dần; `reasons` là chuỗi ngắn người đọc được.
- `sfx.find` cùng giao diện, chỉ trả `kind = sfx`, bỏ qua `min_duration_ms`.
- Không có kết quả → `E_MUSIC_NOT_FOUND` kèm gợi ý nới điều kiện.

Công thức xếp hạng và cách phân tích: FN-012/021.

## 3. Đặt nhạc vào video

- `sf-scene.music` (D3) là nguồn: `track_id` khi đã chọn, `query` khi chưa, hoặc `'none'`.
- File nhạc dùng trong video nằm ở `public/music/<track_id>.<ext>`.
- Phần tử audio nhạc trong `index.html` mang các thuộc tính (hợp đồng chung với Studio, D9 mục 3.3): `data-sf-track`, `data-volume-db`, `data-fade-in-ms`, `data-fade-out-ms`, `data-duck-db`.
- SFX: `sf-frame.sfx[]` (D3), không ducking. 2026-10-10: đạo diễn ghi `config.sfx_plan` (mô tả tiếng Anh, `at_ms` từ đầu frame, `volume_db` −18/−12/−6 so với giọng) chỉ ở cảnh có âm thật sự; bước `media` tìm trong kho SFX kênh + app (CLAP cosine ≥ 0,3, hoặc khớp từ khóa khi chưa có CLAP) → `sfx[]`; không có → báo trong tóm tắt bước (bộ tạo SFX Stable Audio Open qua ComfyUI: giai đoạn sau). `index.html`: mỗi âm một `<audio>` ở đầu frame + `at_ms`, âm lượng = độ to giọng đo được + `volume_db` − `loudness_lufs` của âm (kẹp ≤ 1). Nạp gói SFX: tab Nhạc → Loại: hiệu ứng âm thanh (không chọn → file < 10 s tự là SFX).
- Mức âm lượng/ducking lấy từ khóa `music.volume_db`, `music.duck_db` (D3 mục 7.2). `volume_db` là mức nhạc **so với loudness tích hợp của lời đọc** (đo trên các file line; không đo được → −20 LUFS): nhạc chuẩn hóa về `giọng + volume_db` (kẹp −40…−10 LUFS), khi có lời hạ thêm `duck_db`. Bản cuối đạt `loudness_lufs` của output profile.

## 4. Ghi công
`CREDITS.txt` sinh khi render phát hành, chỉ gồm các bài nhạc/asset đã dùng có `attribution`; không có mục nào → không tạo file. Định dạng: FN-012/021.

## 7. Mã lỗi

| Mã | Khi |
|---|---|
| `E_AUDIO_UNSUPPORTED` | Định dạng không đọc được |
| `E_AUDIO_ANALYSIS` | Phân tích lỗi (retryable) |
| `E_MUSIC_NOT_FOUND` | Không có bài thỏa lọc cứng (kèm gợi ý nới điều kiện) |
