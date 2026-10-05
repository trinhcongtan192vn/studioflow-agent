# Implementation Plan: Lip-sync mức 1

**Branch**: `032-lipsync-level1` | **Date**: 2026-10-05 | **Spec**: [spec.md](spec.md)

## Summary
`lipsync/amplitude.ts` (`computeCues`, provider), `lipsync/builder.ts` (nút `lipsync.line`), `lipsync/mouths.ts` (`frameLipsync`, `applyLipsync`, `mouthDir`), `lipsync/step.ts` (executor, tool, objective); graph: `lipsyncLines`, nút + phụ thuộc `frame_html`, phần `lipsync` trong `finishPart`; `hf/frame-builder.ts` chèn miệng; `hf/packet.ts` quy tắc layer miệng; gói `core-mouths`; skill short-film. Test: `lipsync.test.ts`, E2E `short-film.test.ts` bật lip-sync.

## Constitution Check
- [x] I · [x] II/III · [x] IV · [x] V · [x] VI · [x] VII · [x] VIII · [x] IX · [x] X.
