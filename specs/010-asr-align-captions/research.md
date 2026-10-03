# Research — 010

## R1. ASR qua `hyperframes transcribe`
- **Decision**: provider `asr.hf-transcribe` gọi `hyperframes transcribe <wav> --json --engine whisper --model <m> --language <lang>` (hyperframes 0.8.115 ghim trong `packages/core`). Trên Windows hyperframes không tự dựng whisper.cpp (cần cmake) → app đặt `HYPERFRAMES_WHISPER_PATH` tới `whisper-cli.exe` bản dựng sẵn của whisper.cpp (b5130) trong `<app-data>/providers/whisper/`, và chép/trỏ model vào thư mục model của hyperframes.
- **Lý do**: đúng D4 mục 4.3 (ASR chạy ở `hf-cli`); Parakeet của hyperframes không phủ tiếng Việt; model `.en` không dùng được → `large-v3-turbo` đa ngôn ngữ.
- **Alternatives**: faster-whisper trong worker Python (env OmniVoice có torch cu128) — giữ làm phương án dự phòng nếu whisper.cpp CUDA không chạy trên Blackwell.

## R2. Căn token và mốc từ
- Token = tách theo khoảng trắng sau chuẩn hóa (NFC, chữ thường, bỏ dấu câu Unicode `\p{P}`); WER = Levenshtein(token ASR, token đã đọc)/số token đã đọc.
- Mốc từ lưu trong `audio_meta.lines[].words` là **từ hiển thị của `SCRIPT.md`** (`text`), không phải từ ASR: căn DP token ASR ↔ token hiển thị, từ khớp lấy mốc ASR, từ không khớp nội suy tuyến tính giữa hai mốc khớp lân cận (hoặc biên lời đọc). Line có `tts_text`: rải từ hiển thị theo tỉ lệ số ký tự trên `[đầu từ ASR đầu, cuối từ ASR cuối]`.

## R3. Sinh lại line đọc sai
- `audio.line` có thêm phần đầu vào `regen` (số lần sinh lại của line, từ `.sf/asr.json`); `regen > 0` → `seed = regen` gửi tới provider TTS (vào khóa cache) → audio khác. Vòng: build `asr.line` → line `mismatch` có `regen < asr.max_regen` → tăng `regen` → build lại các nút `audio.line/asr.line/audio_meta/captions` của line đó. Không đổi nút `audio.line` đã fresh của line khác.
- `asr_regen_count` trong D3 5.7 chỉ nằm trong chú thích → không thêm trường vào `AudioMeta`; số lần lưu ở `.sf/asr.json` (dẫn xuất; mất → đếm lại từ 0, an toàn).

## R4. Chấp nhận line lệch
- `.sf/asr.json.accepted[line_id] = content_hash` audio tại lúc chấp nhận; `audio_meta` áp `asr_flag = accepted` khi `content_hash` còn khớp. File này vào phần đầu vào của `audio_meta` để build lại. Dọn dữ liệu dẫn xuất → line hiện lại `mismatch` (hỏi lại, không mất dữ liệu nguồn).

## R5. Caption groups
- Cụm trong một line: duyệt từ, ngắt khi đủ `caption.max_words` hoặc sau từ kết thúc bằng `.,;:!?…` khi cụm ≥ 2 từ; cụm cuối quá ngắn (1 từ) gộp vào cụm trước nếu không vượt `max_words + 2`.
- `start_ms/end_ms` = `line.start_ms` + mốc từ (chuỗi lời đọc). `emphasis` = chỉ số từ có chữ số hoặc viết hoa không ở đầu câu. ID = `seededId('cg', line_id + word_range)` → ổn định.

## R6. Đo trên máy tham chiếu (2026-10-04, RTX 5060 Ti 16 GB)
- whisper.cpp b5130 CUDA 12.4 chạy trên Blackwell (sm_120) qua JIT PTX; lần đầu ~30 s (biên dịch kernel, có cache), sau đó ~2,5 s/line (nạp model mỗi lần gọi `hyperframes transcribe`).
- 2 câu tiếng Việt do OmniVoice đọc: WER 0,000; so với văn bản khác: WER 1,000 → ngưỡng tạm 0,15 tách rõ (đủ cho M1; S12 với 200 line vẫn cần).
- `seed` OmniVoice tái lập: cùng seed → cùng byte; seed khác → audio khác.

## R7. `output_hash` của nút gồm cả `meta`
- **Decision**: hash đầu ra nút build graph = hash file đầu ra + `canonical_json(meta)` (trước đây chỉ file nếu có). Lý do: sinh lại `audio.line` có thể cho cùng byte nhưng `content_hash` khác (khóa cache theo seed) → `audio_meta` phải build lại. Ảnh hưởng: `graph.json` cũ thành `stale` một lần (dữ liệu dẫn xuất).
