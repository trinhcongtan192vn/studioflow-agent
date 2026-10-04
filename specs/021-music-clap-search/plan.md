# Implementation Plan: Tìm nhạc bằng mô tả (CLAP)

**Branch**: `021-music-clap-search` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

## Summary
Worker `engines/clap.py` (task `music.embed`, `text.embed`). Core: `music/clap.ts` (provider `audio.clap` + `embedTexts`), `music/npy.ts`, `addTracks` thêm embedding, `embedMissing` (`sf music reindex`), `findMusicSemantic` (FN-021) dùng cho tool `music.find`/`sfx.find` và CLI. Gói `extensions/providers/audio.clap`. Installer: `refs/main` không xuống dòng.

## Technical Context
Python 3.12, torch 2.8.0 CPU, transformers 4.57.1, librosa 0.11 · TS/Node 22 · Testing: unit `music-semantic.test.ts` (npy, công thức), integration `clap.test.ts` (CLAP thật khi đã cài; bỏ qua nếu chưa), pytest engine (bỏ qua khi thiếu model).

## Constitution Check
- [x] I · [x] II/III · [x] IV · [x] V (D8, D4) · [x] VI (vector ghi qua WriteStore của kho) · [x] VII (cache theo hash) · [x] VIII · [x] IX · [x] X (CLAP CPU chạy thật).

## Complexity Tracking
Không có vi phạm.
