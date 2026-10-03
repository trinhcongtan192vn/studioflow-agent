# Feature Specification: ASR căn chỉnh, kiểm đọc sai, `caption_groups.json`

**Feature Branch**: `010-asr-align-captions`

**Created**: 2026-10-04

**Status**: Draft

**Input**: Backlog dòng 010: "`asr-align-captions`: `asr.align`, kiểm đọc sai, `caption_groups.json`".

**Phủ yêu cầu**: FR-VO-03, FR-CP-02.

**Dựa trên `docs/`**: D4 mục 2.4 (tool `asr.align`, `asr.accept`), 3 (`AsrAlignInput/Output`), 4.3 (provider `asr.hf-transcribe`, `asr.fake`), 6 (engine GPU `asr`, pha `tts → asr`), 7 (cache), 8.1–8.3 (nút `asr.line`, `audio_meta`, `captions`) · D3 mục 5.7 (`audio_meta.json`), 5.8 (`caption_groups.json`), 7.2 (`asr.wer_threshold.<lang>`, `asr.max_regen`, `caption.style`, `caption.max_words`) · FN-common mục 3 (quy tắc cụm caption) · D12 (`asr.fake` khi `SF_GPU=0`, nhãn `gpu`).

## Bối cảnh & mục tiêu
Sau khi sinh giọng, app nghe lại từng line bằng ASR để (1) phát hiện line TTS đọc sai so với kịch bản và tự sinh lại, (2) lấy mốc thời gian từng từ để caption chạy khớp lời đọc. Chữ caption luôn lấy từ `SCRIPT.md`, chỉ mốc thời gian lấy từ ASR.

## User Scenarios & Testing *(mandatory)*

### US1 — Kiểm đọc sai và sinh lại (P1) — FR-VO-03
1. **Given** video có audio các line, **When** `asr.align` (hoặc bước `voice`) chạy, **Then** mỗi line có `words`, `asr_wer`, `asr_flag` trong `audio_meta.json`; WER tính trên văn bản đã đọc (`tts_text` nếu có, ngược lại `text`) sau chuẩn hóa (chữ thường, bỏ dấu câu, Unicode NFC).
2. Line có `asr_wer > asr.wer_threshold.<lang>` → `mismatch`; app tự sinh lại audio line đó (seed khác) tối đa `asr.max_regen` lần, mỗi lần căn chỉnh lại; vẫn lệch → giữ `mismatch` và báo người dùng.
3. `asr.accept` với `line_ids` → `asr_flag = accepted` cho audio hiện tại của line; audio line đổi → quyết định mất hiệu lực.

### US2 — Caption groups (P1) — FR-CP-02
1. `caption_groups.json` sinh từ `audio_meta` + chữ `SCRIPT.md`: cụm ≤ `caption.max_words` từ, không vắt qua hai line, ngắt ưu tiên sau dấu câu; mỗi cụm có `word_range`, `text`, `start_ms`, `end_ms` (trên chuỗi lời đọc), `emphasis` (chỉ số từ: số, tên riêng), `speaker`.
2. ID cụm ổn định: cùng line + cùng `word_range` → cùng `cg_` ID qua các lần build (để `caption-overrides.json` bám được).
3. Line có `tts_text` (đọc khác chữ hiển thị): mốc từ của chữ hiển thị chia theo tỉ lệ độ dài trên khoảng lời đọc của line.

### US3 — Provider (P1)
1. `asr.hf-transcribe` gọi `hyperframes transcribe` (ghim phiên bản) với whisper.cpp và model đa ngôn ngữ; engine GPU `asr`.
2. `asr.fake` (khi `SF_GPU=0`): từ của văn bản mong đợi rải đều trên thời lượng file, WER 0 — CI không GPU.
3. Thiếu `whisper-cli`/model → `E_PROVIDER_UNAVAILABLE` kèm hướng dẫn `node scripts/setup-engine.mjs asr`.

### US4 — Build graph (P1)
`asr.line` (theo line, pha `asr`) và `captions` có builder; đổi chữ một line chỉ làm line đó `stale` qua `audio.line → asr.line → audio_meta → captions`.

### Edge Cases
- ASR trả rỗng (im lặng/lỗi) → WER 1, `mismatch`.
- Line chỉ có dấu câu/rỗng sau chuẩn hóa → WER 0, không cụm caption.
- Số từ ASR khác số từ kịch bản → căn bằng quy hoạch động (Levenshtein theo token); từ kịch bản không khớp lấy mốc nội suy giữa hai từ khớp lân cận.

## Requirements *(mandatory)*
- **FR-001**: Provider `asr.hf-transcribe` (`hyperframes transcribe --json`, `HYPERFRAMES_WHISPER_PATH`, model ghi trong manifest `models: [large-v3-turbo]`) và `asr.fake`; manifest trong `extensions/providers/`.
- **FR-002**: Chuẩn hóa văn bản + WER theo từ; căn chỉnh token ASR ↔ token kịch bản.
- **FR-003**: Builder `asr.line`: gọi `asr.align` qua `runCapability` (cache theo hash audio + văn bản), meta `{words, asr_wer, asr_flag}`.
- **FR-004**: Sinh lại line `mismatch` tối đa `asr.max_regen` lần: tăng `regen` của line → `audio.line` dùng seed khác → build lại; số lần lưu `.sf/asr.json`.
- **FR-005**: `asr.accept` lưu chấp nhận theo `content_hash` audio vào `.sf/asr.json`; `audio_meta` áp `accepted`.
- **FR-006**: Builder `captions` → `caption_groups.json` (D3 5.8) theo FN-common mục 3.
- **FR-007**: Tool Gateway `asr.align` (job), `asr.accept`; bước `voice` chạy căn chỉnh + sinh lại.
- **FR-008**: CLI `sf asr align --channel --video [--lines ln_a,ln_b]`, `sf asr accept --channel --video --lines …`; `node scripts/setup-engine.mjs asr` cài `whisper-cli` + model.
- **FR-009**: OmniVoice nhận `seed` (tái lập; seed vào khóa cache).

## Success Criteria
- **SC-001**: Trên GPU tham chiếu, câu tiếng Việt do OmniVoice đọc đúng có WER ≤ 0,15; câu cố ý đọc khác có WER > 0,15 (kiểm `gpu`).
- **SC-002**: CI không GPU: căn chỉnh, sinh lại, chấp nhận, caption groups chạy với `asr.fake`/provider giả lỗi.

## Ngoài phạm vi
Bảng chỉnh caption (026), `caption-overrides.json` áp lên index (011/026), phát hiện `orphan` (026), chọn model ASR trong UI (014), đo ngưỡng S12 đầy đủ (200 line).

## Assumptions
- Ngưỡng WER tạm 0,15 `[chờ S12]` (đã có trong mặc định cấu hình).
- Mốc caption theo chuỗi lời đọc; quy đổi sang mốc tuyệt đối video ở nút `index` (011) dùng `frame_timing`.
