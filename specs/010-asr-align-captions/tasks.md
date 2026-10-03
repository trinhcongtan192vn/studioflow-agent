# Tasks — 010

## Phase 1 — Môi trường
- [x] T001 `hyperframes@0.8.115` vào `packages/core`; `scripts/setup-engine.mjs asr` (whisper-cli + model); manifest `extensions/providers/{asr.hf-transcribe,asr.fake}/provider.yaml`

## Phase 2 — Test fail-trước
- [x] T010 unit `tests/unit/asr-text.test.ts`: chuẩn hóa, WER, căn token, rải mốc, `tts_text` (FR-002)
- [x] T011 unit `tests/unit/captions.test.ts`: cụm theo max_words/dấu câu, không vắt line, emphasis, ID ổn định (FR-006)
- [x] T012 integration `tests/integration/asr-align.test.ts` (`SF_GPU=0`): `asr.line` + `audio_meta` words/WER; line lệch sinh lại tới `asr.max_regen` rồi `mismatch`; `asr.accept`; captions; đổi chữ một line chỉ build lại line đó; tool + CLI (FR-003..008)
- [x] T013 `gpu` `tests/integration/asr-gpu.test.ts`: OmniVoice đọc câu tiếng Việt → WER ≤ 0,15; so với văn bản khác → mismatch (SC-001)
- [x] T014 pytest: OmniVoice nhận `seed` (FR-009)

## Phase 3 — Code
- [x] T020 `asr/text.ts`, `asr/providers.ts`, `asr/state.ts`
- [x] T021 `asr/builder.ts`, `asr/captions.ts`, `audio.line` + `regen/seed`, `audio_meta` áp `accepted`
- [x] T022 `asr/regen.ts`, `asr/tools.ts`, bước `voice`, CLI `asr`

## Phase 4 — Nghiệm thu
- [x] T030 `npm run verify` xanh; chạy `gpu` trên máy tham chiếu
