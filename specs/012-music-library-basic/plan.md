# Implementation Plan: Kho nhạc cơ bản

**Branch**: `012-music-library-basic` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

## Summary
Hợp đồng D8 mục 1–2 sinh vào `docs/contracts/music/d8.ts` (+ schema `MusicManifest`, artifact `music/manifest.json`). Worker Python engine `audio-analysis` (`workers/gpu/src/sf_worker/engines/audio_analysis.py`: librosa, pyloudnorm, soundfile). `packages/core/src/music/`: `provider.ts` (`audio.analysis`), `library.ts` (kho app/kênh, `addTracks`, dedupe, `used_in`), `find.ts` (`music.find`/`sfx.find`), `mix.ts` (bed FFmpeg: đoạn theo scene, crossfade, −24 LUFS, ducking), `credits.ts`, `tools.ts`. Builder `index` thêm bed nhạc + thuộc tính D8 mục 3. CLI `sf music add|find`; `scripts/setup-engine.mjs audio-analysis`.

## Technical Context
TS/Node 22 · Python 3.12 (librosa 0.11.0, pyloudnorm 0.1.1, soundfile 0.13.1 — libsndfile 1.2.2 đọc mp3) · FFmpeg 8.1 · Testing: pytest (phân tích), unit (lọc/xếp hạng/credits/ducking), integration (nạp thật 10 bài tổng hợp, AC-M1-04, đo ducking bằng `astats`).

## Constitution Check
- [x] I · [x] II/III · [x] IV · [x] V (hợp đồng D8 sinh từ docs, không tự định nghĩa) · [x] VI (kho kênh qua module ghi; kho app ghi nội bộ qua WriteStore của app-data) · [x] VII (provenance/cache qua `runCapability`) · [x] VIII · [x] IX · [x] X (phân tích CPU chạy thật trong test).

## Complexity Tracking
Không có vi phạm.
