# Implementation Plan: Giọng gợi ý từ mô tả

**Branch**: `033-voice-design` | **Date**: 2026-10-05 | **Spec**: [spec.md](spec.md)

## Summary
- **docs:**
  - D4: bảng tool, interface `VoiceDesignInput`, ví dụ manifest, bảng 4.3.
  - D3 mục 2: ghi `profile.json` có `design`.
  - PRD: FR-VO-06.
  - Backlog: 033.
  - Sinh lại contracts.
- **worker:** task `voice.design` trong `engines/omnivoice.py`.
- **core:**
  - `tts/design.ts` (`designInstruct`, `defaultSampleText`, `createDesignedVoice`).
  - Job và tool `voice.design`.
  - Provider omnivoice và fake: nhận đầu vào design.
  - `provider.<capability>`: thêm `voice.design`.
  - Manifest `tts.omnivoice` và `tts.fake`.
  - Policy: tool chỉ cho phiên `main`.
- **desktop:**
  - `sf-media`: đọc được `voices/*/ref.wav`.
  - `chat-format`: `voiceSuggestion`, CTA `suggest`.
  - Chat: thẻ giọng gợi ý.
- **skill:** `studioflow` (giọng gợi ý) và `short-film` (bước cast).

## Constitution Check
- [x] I · [x] II/III · [x] IV (test trước) · [x] V · [x] VI · [x] VII · [x] VIII · [x] IX · [x] X.
