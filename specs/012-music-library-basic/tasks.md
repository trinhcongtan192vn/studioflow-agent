# Tasks — 012

## Phase 1 — Hợp đồng, engine
- [x] T001 `scripts/gen-contracts.mjs` sinh D8 → `docs/contracts/music/d8.ts`, schema `MusicManifest`; artifact `music/manifest.json`
- [x] T002 engine `audio-analysis` (pytest `tests/unit/test_audio_analysis.py`), nhóm phụ thuộc `audio`, `setup-engine.mjs audio-analysis`

## Phase 2 — Test fail-trước
- [x] T010 unit `tests/unit/music-find.test.ts`: lọc cứng, xếp hạng, ×2/÷2 BPM, phạt dùng gần đây, `E_MUSIC_NOT_FOUND`, CREDITS, ducking
- [x] T011 integration `tests/integration/music.test.ts`: nạp 10 bài (phân tích thật), dedupe, AC-M1-04, CLI, ducking đo `astats`, index có bed

## Phase 3 — Code
- [x] T020 `music/provider.ts`, `library.ts`, `find.ts`, `tools.ts`
- [x] T021 `music/mix.ts`, `credits.ts`; builder `index` thêm bed nhạc
- [x] T022 CLI `sf music add|find`

## Phase 4 — Nghiệm thu
- [x] T030 `npm run verify` xanh
