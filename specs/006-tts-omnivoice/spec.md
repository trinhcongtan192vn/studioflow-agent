# Feature Specification: TTS OmniVoice

**Feature Branch**: `006-tts-omnivoice`

**Created**: 2026-10-03

**Status**: Draft

**Input**: Backlog dòng 006: "worker Python, `voice.profile`, `tts.synthesize`, `audio_meta.json`, CLI `sf video create`, `sf tts say` (đường kiểm AC-M0-01..03)".

**Phủ yêu cầu**: FR-VO-01 (clone giọng từ file mẫu + nghe thử), FR-VO-02 (audio theo line + `audio_meta.json`), FR-VO-04 (sửa một line chỉ sinh lại line đó — dùng build graph 004), AC-M0-01, AC-M0-02, AC-M0-03.

**Dựa trên `docs/`**: D4 mục 2.4 (`voice.profile_create`, `voice.preview`, `tts.synthesize`), 3 (`VoiceProfileInput/Output`, `TtsInput/Output`), 4.1–4.4 (manifest, adapter, provider mặc định `tts.omnivoice`, dự phòng `tts.vbee`), 6 (engine `omnivoice`), 9.3 (worker Python JSON-RPC stdio), 12 (`sf video create`, `sf tts say`) · D3 mục 1 (`voices/<voice_id>/`), 5.7 · D12 mục 2 (`tts.fake` khi `SF_GPU=0`) · 00-architecture Phụ lục A (OmniVoice: `pip install omnivoice`, clone, ref 3–10 s, lưu/nạp giọng clone) · tech-defaults mục 1 (worker JSON-RPC stdio, `uv`, venv riêng mỗi engine).

## Bối cảnh & mục tiêu

M0 kết thúc khi qua chat đọc được một câu thành file audio có `audio_meta.json` + provenance, chạy lại lấy từ cache, và agent không ghi/chạy lệnh được ngoài Gateway. Tính năng này thêm worker Python giao tiếp JSON-RPC, provider `tts.omnivoice` (clone giọng, sinh theo line), provider giả `tts.fake` cho máy không GPU, builder `audio.line` của build graph, tool `voice.*`/`tts.synthesize` và hai lệnh CLI.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Đọc một câu qua chat (Priority: P1) — AC-M0-01, AC-M0-02

**Independent Test**: phiên `main` thật (record) trên kênh có giọng; yêu cầu "đọc câu X"; kiểm file wav, `audio_meta.json`, provenance; gửi lại → cache.

**Acceptance Scenarios**:
1. **Given** kênh có `voice.id` trỏ giọng đã clone, **When** người dùng yêu cầu qua chat đọc một câu, **Then** agent ghi line vào `SCRIPT.md` qua Gateway và gọi `tts.synthesize`; có `audio/lines/<ln>.wav`, `audio_meta.json` hợp lệ, `provenance/<hash>.json` (`provider: tts.omnivoice`, `from_cache: false`).
2. **Given** cùng câu, cùng giọng, **When** yêu cầu lại (hoặc `sf tts say` hai lần), **Then** lấy từ cache: OmniVoice không được gọi, provenance `from_cache: true`.

### User Story 2 - Clone giọng và nghe thử (Priority: P1) — FR-VO-01

**Acceptance Scenarios**:
1. **Given** file mẫu 3–10 giây trong `uploads/`, **When** `voice.profile_create {name, ref_audio, language}`, **Then** job tạo `voices/<vo>/` (`voice.pt` giọng clone, `ref.wav`, `profile.json`) và trả `voice_id`.
2. **Given** file mẫu < 3 s hoặc > 10 s, **Then** lỗi rõ ràng (`E_AUDIO_UNSUPPORTED` kèm độ dài), không tạo giọng.
3. **When** `voice.preview {voice_id, text}`, **Then** job sinh `.sf/preview/tts-<hash>.wav` để nghe.

### User Story 3 - Audio theo line qua build graph (Priority: P1) — FR-VO-02, FR-VO-04

**Acceptance Scenarios**:
1. **When** `tts.synthesize {line_ids: "all"}`, **Then** job `graph.build` sinh `audio/lines/<ln>.wav` (48 kHz) cho mọi line, `audio_meta.json` hợp lệ.
2. **Given** đã sinh, **When** sửa chữ một line rồi `tts.synthesize "all"`, **Then** chỉ line đó được sinh lại (provider được gọi đúng 1 lần).
3. **Given** line của nhân vật, **Then** dùng `voice_id` của cast; narrator dùng `voice.id`; thiếu giọng → lỗi rõ.

### User Story 4 - Worker Python (Priority: P1)

**Acceptance Scenarios**:
1. Worker là tiến trình riêng mỗi engine, JSON-RPC 2.0 qua stdio, một JSON mỗi dòng, log ra stderr; phương thức `health`, `load`, `offload`, `unload`, `run`, `cancel`; thông báo `progress {job_id, done, total}`.
2. Worker chết giữa chừng → lời gọi đang chờ nhận lỗi `E_PROVIDER_FAILED` (retryable), lần sau khởi động lại worker.
3. `core` thoát → worker bị dừng (không mồ côi).

### User Story 5 - Không GPU (Priority: P1) — D12

**Acceptance Scenarios**:
1. **Given** `SF_GPU=0`, **Then** `tts.fake` (sóng sin theo độ dài chữ, xác định) được dùng thay OmniVoice; toàn bộ test không cần GPU/model.
2. Test gắn nhãn `gpu` chạy OmniVoice thật trên máy tham chiếu.

### User Story 6 - CLI (Priority: P2)

1. `sf video create <channel_dir> [--title]` → `{video_id}` (`phase: briefing`).
2. `sf tts say --channel <dir> --voice <id> --text <t> [--out <rel>]` → `{file, duration_ms, from_cache}`; chạy lại → `from_cache: true`.
3. `sf voice create --channel <dir> --name <n> --ref <file> --language <vi|de|en>` → `{voice_id}`.

### Edge Cases
- Text rỗng → `E_SCHEMA_INVALID`.
- Text dài hơn `limits.max_chars` (600) → lỗi rõ, gợi ý tách line.
- Môi trường Python của engine chưa cài → provider không khả dụng (`health` false) → `E_PROVIDER_UNAVAILABLE` gợi ý cài hồ sơ Chuẩn (014).
- Ref audio stereo/44.1 kHz → chuẩn hóa mono 24 kHz cho OmniVoice; đầu ra luôn 48 kHz mono 16-bit.

## Requirements *(mandatory)*

- **FR-001**: Worker Python `sf_worker serve --engine <e>` theo D4 mục 9.3; engine `omnivoice` (thật) và `fake` (stdlib, cho test giao thức).
- **FR-002**: Client JSON-RPC trong `core`: khởi động lười, tiến độ, hủy, timeout, khởi động lại khi worker chết, dừng khi `core` thoát.
- **FR-003**: Provider `tts.omnivoice` (manifest `extensions/providers/tts.omnivoice/provider.yaml`) cài `ProviderAdapter` cho `tts.synthesize` và `voice.profile`; `cacheKeyParts` = {text đã chuẩn hóa, voice_id, hash `voice.pt`, emotion, speed, language}.
- **FR-004**: Provider `tts.fake` (node) chỉ đăng ký khi `SF_GPU=0` và được chọn khi provider cấu hình không khả dụng.
- **FR-005**: Đầu ra TTS: WAV PCM 16-bit mono 48 kHz (D4 mục 3 `sample_rate: 48000`).
- **FR-006**: Builder `audio.line` của build graph dùng `runCapability` (cache + provenance) với provider giải theo D4 mục 4.4.
- **FR-007**: Tool `voice.profile_create`, `voice.preview`, `tts.synthesize` (job) theo D4 mục 2.4; `tts.synthesize` hỏi người dùng khi vượt `policy.batch.tts_lines` (qua `graph.build`).
- **FR-008**: Giọng clone lưu `voices/<vo>/` qua module ghi: `voice.pt`, `ref.wav`, `profile.json` `{voice_id, name, language, ref_text, provider, created_at}`.
- **FR-009**: CLI `sf video create`, `sf tts say`, `sf voice create`.
- **FR-010**: Môi trường engine: `<app-data>/providers/python/omnivoice/` (venv riêng), model tải về `<app-data>/models/hf`; script cài cho dev (`scripts/setup-engine.mjs omnivoice`) — trình cài chính thức là 014.

## Success Criteria *(mandatory)*
- **SC-001**: AC-M0-01/02 đạt với OmniVoice thật trên máy tham chiếu (RTX 5060 Ti 16 GB).
- **SC-002**: Ghi nhận cho S1: thời gian sinh / thời lượng audio, VRAM đỉnh, dung lượng model (MOS do Tan chấm sau).
- **SC-003**: Toàn bộ test không nhãn `gpu` chạy được với `SF_GPU=0`.

## Phạm vi
**Trong**: worker Python + client, `tts.omnivoice`, `tts.fake`, builder `audio.line`, tool voice/tts, CLI, script cài engine cho dev.
**Ngoài**: ASR kiểm đọc sai (010), lịch GPU đa engine/offload theo VRAM (019), trình cài/tải model có tiến độ (014), `tts.vbee` (chỉ khi S1 không đạt), upload qua UI (008).

## Assumptions
- Phiên bản ghim: `omnivoice==0.2.1`, `torch==2.8.0+cu128`, model `k2-fsa/OmniVoice` (3,27 GB).
- `ref_text` của giọng clone lấy bằng Whisper tự động của OmniVoice khi không cung cấp.
- Biến thể cảm xúc (`emotion`) ở 006: khóa emotion → file ref riêng của giọng nếu có (`CastMember.emotions`), không có → giọng gốc.
