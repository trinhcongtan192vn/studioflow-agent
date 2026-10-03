# Implementation Plan: ASR căn chỉnh, kiểm đọc sai, caption groups

**Branch**: `010-asr-align-captions` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

## Summary
`packages/core/src/asr/`: `text.ts` (chuẩn hóa, token, WER, căn token DP, rải mốc), `providers.ts` (`asr.hf-transcribe` chạy `hyperframes transcribe --json` bằng `child_process`, `asr.fake`), `builder.ts` (nút `asr.line`), `state.ts` (`.sf/asr.json`: `regen`, `accepted`), `regen.ts` (vòng căn chỉnh + sinh lại dùng chung cho tool, CLI, bước `voice`), `captions.ts` (builder `captions` → `caption_groups.json`), `tools.ts` (`asr.align` job, `asr.accept`). `audio.line` nhận `regen` → `seed`; OmniVoice nhận `seed`. Phụ thuộc mới: `hyperframes@0.8.115` (ghim, dùng lại ở 011/013). `scripts/setup-engine.mjs asr` tải `whisper-cli` (whisper.cpp bản dựng sẵn) + model `ggml-large-v3-turbo.bin` vào `<app-data>/providers/whisper/`.

## Technical Context
TS/Node 22 · hyperframes CLI (Node, cùng `node_modules`) · whisper.cpp b5130 (CUDA 12.4 hoặc CPU) · Storage: `audio_meta.json`, `caption_groups.json`, `.sf/asr.json`, cache capability · Testing: unit (WER, căn token, cụm caption), integration (`SF_GPU=0`, `asr.fake` + adapter giả lỗi để thử sinh lại), `gpu` (OmniVoice + whisper thật, SC-001).

## Constitution Check
- [x] I (thư viện trong `packages/core`) · [x] II/III (CLI `sf asr …` JSON) · [x] IV (test trước) · [x] V (`AsrAlignInput/Output`, `AudioMeta`, `CaptionGroups` từ `docs/contracts`) · [x] VI (mọi ghi qua module ghi) · [x] VII (provenance qua `runCapability`; log WER) · [x] VIII · [x] IX (adapter provider là ranh giới đã định) · [x] X (GPU/ASR thật ở nhãn `gpu`; CI dùng `asr.fake`).

## Complexity Tracking
Không có vi phạm.
