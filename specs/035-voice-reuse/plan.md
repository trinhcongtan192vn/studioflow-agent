# Implementation Plan: Dùng lại giọng/nhân vật

**Branch**: `035-voice-reuse` | **Date**: 2026-10-06 | **Spec**: [spec.md](spec.md)

## Summary
- **docs:** D4 bảng tool (`voice.list`, `cast.list`), PRD FR-VO-07, backlog 035.
- **core:** `tts/library.ts` (`listVoices`, `listCast`), tool trong `ttsTools`, policy `cast.list`; chỉ dẫn bàn giao bước voice (034).
- **skill:** `studioflow` mục Giọng đọc và `short-film` bước cast.
- **test:** `voice-library.test.ts` (SC-001, SC-003), `gateway-policy` (SC-002).

## Constitution Check
- [x] I · [x] II/III · [x] IV · [x] V · [x] VI · [x] VII · [x] VIII · [x] IX · [x] X.
